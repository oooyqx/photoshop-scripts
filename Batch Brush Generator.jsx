// =====================================================================
// Batch Brush Generator
// Batch random brush stroke generator
// Install: Photoshop/Presets/Scripts/
// Run: File > Scripts > Batch Brush Generator
// Compatible: Photoshop CC 2019+
// =====================================================================

#target photoshop
app.bringToFront();

// ========== Defaults ==========
var DEFAULTS = {
    width: 256,                   // cell width (before stitching)
    height: 256,                  // cell height
    outputFolder: Folder.desktop.fsName.replace(/\\/g, "/") + "/brush_output",
    brushNames: [],
    gridCols: 2,                  // grid columns
    gridRows: 2,                  // grid rows
    strokesPerImage: 20,          // strokes per cell
    brushSizeMin: 8,              // Tab 2 only (absolute px, clamped if clampToNative)
    brushSizeMax: 64,             // same as above
    scaleMin: 0.3,                // Tab 1: min ratio of stroke long-side vs cell short-side
    scaleMax: 0.8,                // Tab 1: max ratio of stroke long-side vs cell short-side
    colorMode: "palette",         // "palette" / "random" / "solid" / "family" / "mono"
    palette: [
        [239, 71, 111],
        [255, 209, 102],
        [6, 214, 160],
        [17, 138, 178],
        [7, 59, 76]
    ],
    mainColor: [255, 107, 107],   // used by solid / family / mono modes
    bgColor: [255, 255, 255],
    transparentBg: false,         // transparent background (PNG with alpha)
    xJitterPct: 25,               // X jitter as % of slot width
    yJitterPct: 15,               // Y jitter as % of canvas height
    fixedCoords: false,           // all cells use same coordinate template
    fixedSize: false,             // all cells use same size template
    randomRotate: false,          // Tab 1: random rotation 0-360 per stroke
    drawProbability: 100,         // per-stroke draw probability 0-100
    allowUpscale: false,          // allow upscale beyond native brush Dmtr (slight blur)
    fitToCell: true,              // Tab 2: scale each stroke to fitToCellPct% of cell short-side
    fitToCellPct: 95,             // Tab 2: target fill ratio (% of cell short-side)
    customGroups: {}              // { groupName: [brushName...] }
};

// After each image is drawn, reset the brush preset Dmtr to this value.
// Purpose: some sampled-tip brushes have very small default Dmtr (10-30px), so
// the probed actualPx is also small, clamping fitTmpDocSize to the 1024 floor,
// causing an oversized ratio when scaling to cell and blurry output.
// Presetting a larger Dmtr after each image means the next selectBrushByName
// inherits a larger starting size (PS CC 2019 behaviour), so the probe returns
// a more meaningful size, the scale ratio stays near 1, and textures are sharper.
//
// Timing: must be called AFTER an image is fully drawn, NOT before drawing starts.
// Calling it before would let setBrushSizeForce corrupt the sample tip bitmap
// of the currently selected brush (degrades it to a soft-round base).
var DRAW_SIZE_RESET = 512;

// Grid presets (dropdown just fills the col/row inputs; actual generation uses the inputs)
var GRID_OPTIONS = [
    { id: "custom", cols: 0, rows: 0, label: "Custom (use inputs on the right)" },
    { id: "1x1", cols: 1, rows: 1, label: "1 x 1 (single)" },
    { id: "1x2", cols: 1, rows: 2, label: "1 x 2 (vertical)" },
    { id: "2x2", cols: 2, rows: 2, label: "2 x 2" },
    { id: "2x3", cols: 2, rows: 3, label: "2 x 3" },
    { id: "2x4", cols: 2, rows: 4, label: "2 x 4" },
    { id: "3x3", cols: 3, rows: 3, label: "3 x 3" },
    { id: "4x4", cols: 4, rows: 4, label: "4 x 4" }
];

function getGridById(id) {
    for (var i = 0; i < GRID_OPTIONS.length; i++) if (GRID_OPTIONS[i].id === id) return GRID_OPTIONS[i];
    return GRID_OPTIONS[2]; // fallback 2x2
}

// Config file path (user data dir, persisted across sessions)
var CONFIG_FILE = new File(Folder.userData + "/BatchBrushGenerator_config.json");

// ========== Entry point ==========
main();

function main() {
    var loaded = loadConfig();
    showDialog(loaded || DEFAULTS);  // dialog manages generation and persistence internally
}

// =====================================================================
// UI
// =====================================================================
function showDialog(d) {
    var win = new Window("dialog", "Batch Brush Generator");
    win.orientation = "column";
    win.alignChildren = "fill";
    win.margins = 16;
    win.spacing = 10;

    // ---- Canvas size ----
    var sizePanel = win.add("panel", undefined, "Canvas Size");
    sizePanel.orientation = "row";
    sizePanel.margins = 12;
    sizePanel.alignChildren = "left";
    sizePanel.add("statictext", undefined, "Cell W (px):");
    var wInput = sizePanel.add("edittext", undefined, d.width);
    wInput.characters = 6;
    sizePanel.add("statictext", undefined, "  Cell H (px):");
    var hInput = sizePanel.add("edittext", undefined, d.height);
    hInput.characters = 6;
    sizePanel.add("statictext", undefined, "  BG:");
    var bgSwatch = makeColorSwatch(sizePanel, d.bgColor);
    var transparentCb = sizePanel.add("checkbox", undefined, "Transparent");
    transparentCb.value = !!d.transparentBg;
    transparentCb.helpTip = "Output PNG with alpha channel (transparent background).\n\nParticle texture tip:\n· Additive/Screen blend -> black bg (better perf, smaller file)\n· Alpha Blend -> transparent bg";
    transparentCb.onClick = function () {
        bgSwatch.group.enabled = !transparentCb.value;
    };
    bgSwatch.group.enabled = !transparentCb.value;

    // ---- Output folder ----
    var outPanel = win.add("panel", undefined, "Output Folder");
    outPanel.orientation = "row";
    outPanel.margins = 12;
    var outInput = outPanel.add("edittext", undefined, d.outputFolder);
    outInput.characters = 40;
    var pickBtn = outPanel.add("button", undefined, "Browse...");
    pickBtn.onClick = function () {
        var f = Folder.selectDialog("Select output folder");
        if (f) outInput.text = f.fsName.replace(/\\/g, "/");
    };
    var openBtn = outPanel.add("button", undefined, "Open");
    openBtn.onClick = function () {
        var f = new Folder(outInput.text);
        if (!f.exists) f.create();
        f.execute();
    };

    // ---- Brush list (group management) ----
    var brushPanel = win.add("panel", undefined, "Brush List  (Ctrl/Shift multi-select)");
    brushPanel.orientation = "column";
    brushPanel.alignChildren = "fill";
    brushPanel.margins = 12;

    var ALL_GROUP = "<All Brushes>";
    var customGroups = (d.customGroups && typeof d.customGroups === "object") ? cloneObj(d.customGroups) : {};
    var currentGroup = ALL_GROUP;

    // Group row
    var groupRow = brushPanel.add("group");
    groupRow.orientation = "row";
    groupRow.alignChildren = "center";
    groupRow.add("statictext", undefined, "Group:");
    var groupDropdown = groupRow.add("dropdownlist", undefined, []);
    groupDropdown.preferredSize = [180, 22];
    var newGroupBtn = groupRow.add("button", undefined, "+ New Group");
    newGroupBtn.helpTip = "Save currently checked brushes as a named group for quick reuse";
    var renameGroupBtn = groupRow.add("button", undefined, "Rename");
    var delGroupBtn = groupRow.add("button", undefined, "Delete Group");

    // Filter row
    var searchGroup = brushPanel.add("group");
    searchGroup.orientation = "row";
    searchGroup.alignChildren = "center";
    searchGroup.add("statictext", undefined, "Filter:");
    var searchInput = searchGroup.add("edittext", undefined, "");
    searchInput.characters = 28;
    searchInput.helpTip = "Type keyword to filter list (case-insensitive)";
    var brushCountLabel = searchGroup.add("statictext", undefined, "");
    brushCountLabel.preferredSize = [220, 18];

    // Multi-select list
    var brushListBox = brushPanel.add("listbox", undefined, [], { multiselect: true });
    brushListBox.preferredSize = [500, 220];

    // Data: all brushes + selection state preserved across filter changes
    var allBrushes = [];
    var selectedBrushes = {};
    var ignoreSelectionChange = false;

    function refreshDisplay() {
        ignoreSelectionChange = true;
        var keyword = searchInput.text.replace(/^\s+|\s+$/g, "").toLowerCase();
        // member set for current group (null = All Brushes)
        var memberSet = null;
        var members = getGroupMembers(currentGroup);
        if (members) {
            memberSet = {};
            for (var x = 0; x < members.length; x++) memberSet[members[x]] = true;
        }
        brushListBox.removeAll();
        for (var i = 0; i < allBrushes.length; i++) {
            var name = allBrushes[i];
            if (memberSet && !memberSet[name]) continue;
        if (keyword && name.toLowerCase().indexOf(keyword) === -1) continue;
            var item = brushListBox.add("item", name);
            if (selectedBrushes[name]) item.selected = true;
        }
        ignoreSelectionChange = false;
        updateCounts();
    }

    function getGroupMembers(g) {
        if (g === ALL_GROUP) return null;
        return customGroups[g] || null;
    }

    function refreshGroupDropdown() {
        groupDropdown.removeAll();
        groupDropdown.add("item", ALL_GROUP);
        // User-defined groups
        var names = [];
        for (var g in customGroups) if (customGroups.hasOwnProperty(g)) names.push(g);
        names.sort();
        for (var k = 0; k < names.length; k++) groupDropdown.add("item", names[k]);
        var matched = false;
        for (var j = 0; j < groupDropdown.items.length; j++) {
            if (groupDropdown.items[j].text === currentGroup) {
                groupDropdown.selection = j;
                matched = true;
                break;
            }
        }
        if (!matched) {
            groupDropdown.selection = 0;
            currentGroup = groupDropdown.items[0].text;
        }
    }

    groupDropdown.onChange = function () {
        if (!groupDropdown.selection) return;
        var newGroup = groupDropdown.selection.text;
        if (newGroup === currentGroup) return;
        currentGroup = newGroup;
        var members = getGroupMembers(currentGroup);
        if (members) {
            // Switching to a group: auto-select its members
            selectedBrushes = {};
            for (var i = 0; i < members.length; i++) {
                for (var j2 = 0; j2 < allBrushes.length; j2++) {
                    if (allBrushes[j2] === members[i]) { selectedBrushes[members[i]] = true; break; }
                }
            }
        }
        refreshDisplay();
    };

    newGroupBtn.onClick = function () {
        var sel = [];
        for (var k in selectedBrushes) if (selectedBrushes[k]) sel.push(k);
        if (sel.length === 0) { alert("Please check at least one brush to save to a new group"); return; }
        var idx = countObj(customGroups) + 1;
        var name = prompt("New group name:", "My Brushes " + idx);
        if (name === null) return;
        name = String(name).replace(/^\s+|\s+$/g, "");
        if (!name || name === ALL_GROUP) { alert("Invalid group name"); return; }
        if (customGroups[name] && !confirm("Group \"" + name + "\" already exists. Overwrite?")) return;
        customGroups[name] = sel.slice();
        currentGroup = name;
        refreshGroupDropdown();
        refreshDisplay();
    };

    renameGroupBtn.onClick = function () {
        if (currentGroup === ALL_GROUP) { alert("Built-in group cannot be renamed"); return; }
        var newName = prompt("Rename to:", currentGroup);
        if (newName === null) return;
        newName = String(newName).replace(/^\s+|\s+$/g, "");
        if (!newName || newName === ALL_GROUP || newName === currentGroup) return;
        if (customGroups[newName] && !confirm("Group \"" + newName + "\" already exists. Overwrite?")) return;
        customGroups[newName] = customGroups[currentGroup];
        delete customGroups[currentGroup];
        currentGroup = newName;
        refreshGroupDropdown();
        refreshDisplay();
    };

    delGroupBtn.onClick = function () {
        if (currentGroup === ALL_GROUP) { alert("Built-in group cannot be deleted"); return; }
        if (!confirm("Delete group \"" + currentGroup + "\"?\n(Brushes themselves are not deleted)")) return;
        delete customGroups[currentGroup];
        currentGroup = ALL_GROUP;
        refreshGroupDropdown();
        refreshDisplay();
    };

    function updateCounts() {
        var sel = 0;
        for (var k in selectedBrushes) if (selectedBrushes[k]) sel++;
        brushCountLabel.text = "Total " + allBrushes.length + "  Shown " + brushListBox.items.length + "  Selected " + sel;
        if (typeof updateInfo === "function") updateInfo();
    }

    brushListBox.onChange = function () {
        if (ignoreSelectionChange) return;
        // write visible item selection back to selectedBrushes (hidden items unchanged)
        var visible = {};
        for (var i = 0; i < brushListBox.items.length; i++) visible[brushListBox.items[i].text] = false;
        var sel = brushListBox.selection;
        if (sel) {
            if (sel.length === undefined) sel = [sel];
            for (var j = 0; j < sel.length; j++) visible[sel[j].text] = true;
        }
        for (var n in visible) selectedBrushes[n] = visible[n];
        updateCounts();
    };

    searchInput.onChanging = refreshDisplay;

    // Action buttons
    var brushBtns = brushPanel.add("group");
    brushBtns.orientation = "row";
    var refreshBtn = brushBtns.add("button", undefined, "Refresh");
    refreshBtn.helpTip = "Re-read all brush presets from Photoshop";
    refreshBtn.onClick = function () {
        allBrushes = getAllLoadedBrushes();
        if (allBrushes.length === 0) {
            alert("No brush presets found.\nMake sure brushes are loaded in PS (press B, open Brush Presets panel).");
        }
        refreshDisplay();
    };
    var selectAllBtn = brushBtns.add("button", undefined, "All (visible)");
    selectAllBtn.onClick = function () {
        ignoreSelectionChange = true;
        for (var i = 0; i < brushListBox.items.length; i++) {
            brushListBox.items[i].selected = true;
            selectedBrushes[brushListBox.items[i].text] = true;
        }
        ignoreSelectionChange = false;
        updateCounts();
    };
    var noneBtn = brushBtns.add("button", undefined, "None (visible)");
    noneBtn.onClick = function () {
        ignoreSelectionChange = true;
        for (var i = 0; i < brushListBox.items.length; i++) {
            brushListBox.items[i].selected = false;
            selectedBrushes[brushListBox.items[i].text] = false;
        }
        ignoreSelectionChange = false;
        updateCounts();
    };
    var invertBtn = brushBtns.add("button", undefined, "Invert (visible)");
    invertBtn.onClick = function () {
        ignoreSelectionChange = true;
        for (var i = 0; i < brushListBox.items.length; i++) {
            var it = brushListBox.items[i];
            it.selected = !it.selected;
            selectedBrushes[it.text] = it.selected;
        }
        ignoreSelectionChange = false;
        updateCounts();
    };
    var clearAllBtn = brushBtns.add("button", undefined, "Clear All");
    clearAllBtn.onClick = function () {
        selectedBrushes = {};
        refreshDisplay();
    };

    // Init: read PS brushes, restore saved selection and groups
    allBrushes = getAllLoadedBrushes();
    if (d.brushNames && d.brushNames.length > 0) {
        for (var i0 = 0; i0 < d.brushNames.length; i0++) selectedBrushes[d.brushNames[i0]] = true;
    }
    refreshGroupDropdown();
    refreshDisplay();

    // ---- Tab container ----
    var tabbedPanel = win.add("tabbedpanel");
    tabbedPanel.alignChildren = ["fill", "top"];
    tabbedPanel.preferredSize.width = 760;

    var tab1 = tabbedPanel.add("tab", undefined, "Multi-Stroke Grid");
    tab1.orientation = "column";
    tab1.alignChildren = "fill";
    tab1.margins = 8;

    var tab2 = tabbedPanel.add("tab", undefined, "Single Stroke");
    tab2.orientation = "column";
    tab2.alignChildren = "fill";
    tab2.margins = 8;

    tabbedPanel.selection = tab1;

    // ---- Parameters (Tab 1) ----
    var paramPanel = tab1.add("panel", undefined, "Parameters");
    paramPanel.orientation = "column";
    paramPanel.alignChildren = "left";
    paramPanel.margins = 12;
    paramPanel.spacing = 6;

    var row1 = paramPanel.add("group");
    row1.add("statictext", undefined, "Grid:");
    var gridDropdown = row1.add("dropdownlist", undefined, undefined);
    for (var gi = 0; gi < GRID_OPTIONS.length; gi++) {
        gridDropdown.add("item", GRID_OPTIONS[gi].label);
    }
    gridDropdown.helpTip = "Selecting a preset fills the col/row inputs; actual output follows the inputs";
    var gridColsInput = row1.add("edittext", undefined, d.gridCols || DEFAULTS.gridCols);
    gridColsInput.characters = 3;
    gridColsInput.helpTip = "Columns";
    row1.add("statictext", undefined, "x");
    var gridRowsInput = row1.add("edittext", undefined, d.gridRows || DEFAULTS.gridRows);
    gridRowsInput.characters = 3;
    gridRowsInput.helpTip = "Rows";
    // Match current cols/rows to a preset; fall back to Custom
    (function () {
        var matched = 0;
        for (var gj = 1; gj < GRID_OPTIONS.length; gj++) {
            if (GRID_OPTIONS[gj].cols === d.gridCols && GRID_OPTIONS[gj].rows === d.gridRows) { matched = gj; break; }
        }
        gridDropdown.selection = matched;
    })();
    gridDropdown.onChange = function () {
        var opt = GRID_OPTIONS[gridDropdown.selection.index];
        if (opt.cols > 0 && opt.rows > 0) {
            gridColsInput.text = opt.cols;
            gridRowsInput.text = opt.rows;
        }
        if (typeof updateInfo === "function") updateInfo();
    };
    // When inputs change, auto-switch dropdown to Custom unless values match a preset
    function syncDropdownFromInputs() {
        var c = parseInt(gridColsInput.text) || 0;
        var r = parseInt(gridRowsInput.text) || 0;
        var hit = 0;
        for (var gk = 1; gk < GRID_OPTIONS.length; gk++) {
            if (GRID_OPTIONS[gk].cols === c && GRID_OPTIONS[gk].rows === r) { hit = gk; break; }
        }
        gridDropdown.selection = hit;
        if (typeof updateInfo === "function") updateInfo();
    }
    gridColsInput.onChanging = syncDropdownFromInputs;
    gridRowsInput.onChanging = syncDropdownFromInputs;

    row1.add("statictext", undefined, "  Strokes/cell:");
    var strokeCountInput = row1.add("edittext", undefined, d.strokesPerImage);
    strokeCountInput.characters = 4;

    var row2 = paramPanel.add("group");
    var row2Label = row2.add("statictext", undefined, "Stroke size (% cell short-side):");
    row2Label.helpTip =
        "Stroke long-side as % of cell short-side. E.g. 30-80 = each stroke is 30%-80% of cell short-side.\n" +
        "Independent of brush preset Dmtr: script probes actual output size, draws in a large temp doc,\n" +
        "scales to target %, then composites into cell. Output size is stable regardless of PS toolbar size.\n" +
        "Values over 100% require enabling 'Allow Upscale Beyond Cell Short-Side'.";
    var scaleMinInput = row2.add("edittext", undefined,
        Math.round(((d.scaleMin != null ? d.scaleMin : DEFAULTS.scaleMin) * 100)));
    scaleMinInput.characters = 4;
    row2.add("statictext", undefined, "%  —");
    var scaleMaxInput = row2.add("edittext", undefined,
        Math.round(((d.scaleMax != null ? d.scaleMax : DEFAULTS.scaleMax) * 100)));
    scaleMaxInput.characters = 4;
    row2.add("statictext", undefined, "%");
    var testSizeBtn = row2.add("button", undefined, "Visual Test");
    testSizeBtn.helpTip = "Draw 4 rows x 4 strokes using the first checked brush, comparing 4 ActionManager size-setting paths. Each row resets via selectBrushByName.";
    testSizeBtn.onClick = function () {
        var picked = null;
        for (var bk in selectedBrushes) { if (selectedBrushes[bk]) { picked = bk; break; } }
        if (!picked) { alert("Please check at least one brush in the list"); return; }
        var oldUnits = app.preferences.rulerUnits;
        var oldDialogs = app.displayDialogs;
        app.preferences.rulerUnits = Units.PIXELS;
        app.displayDialogs = DialogModes.NO;
        var nativeDmtr = -1;
        // 4 rows: each draws 4 strokes (baseline + size 10/60/200)
        var strategies = [
            { id: "A", label: "Brsh.Mstr+Dmtr (setBrushSizeForce, destructive)",  fn: function (px) { setBrushSizeForce(px); } },
            { id: "B", label: "currentToolOptions.brush.Mstr (= current setBrushSize)", fn: function (px) { setBrushSize(px); } },
            { id: "C", label: "paintbrushTool.brush.Mstr",                            fn: function (px) { _setBrushSize_paintbrushTool(px); } },
            { id: "D", label: "increaseBrushSize/decreaseBrushSize step events",       fn: function (px) { _stepBrushSize_to(px); } }
        ];
        var sizes = [10, 60, 200];
        var xs = [310, 530, 770];        // x coords for strokes 2-4
        var baselineX = 110;             // x coord for baseline stroke
        var rowY = [120, 280, 440, 600]; // y coords for 4 rows
        try {
            var tmpDoc = app.documents.add(900, 720, 72, "__size_visual_test__", NewDocumentMode.RGB, DocumentFill.WHITE);
            var fg = new SolidColor(); fg.rgb.red = 0; fg.rgb.green = 0; fg.rgb.blue = 0;
            app.foregroundColor = fg;
            var fakeC = { strokesPerImage: 1 };  // placeholder

            for (var r = 0; r < strategies.length; r++) {
                // reselect each row to clear previous row's side-effects
                selectBrushByName(picked);
                if (r === 0) nativeDmtr = getCurrentBrushSize();
                // baseline stroke (no size function called)
                drawRandomStroke(fakeC, baselineX, rowY[r]);
                // strokes 2-4
                for (var i = 0; i < sizes.length; i++) {
                    strategies[r].fn(sizes[i]);
                    drawRandomStroke(fakeC, xs[i], rowY[r]);
                }
            }
            // reselect at exit to leave brush library in clean state
            selectBrushByName(picked);
        } catch (e) {
            alert("Visual test failed: " + e);
        }
        app.preferences.rulerUnits = oldUnits;
        app.displayDialogs = oldDialogs;
        alert("4 rows x 4 strokes (each row resets via selectBrushByName).  Native brush size ~ "
              + (nativeDmtr > 0 ? nativeDmtr + "px" : "unknown") + "\n\n"
              + "  Row A: " + strategies[0].label + "\n"
              + "  Row B: " + strategies[1].label + "\n"
              + "  Row C: " + strategies[2].label + "\n"
              + "  Row D: " + strategies[3].label + "\n\n"
              + "Left to right per row: baseline / size=10 / size=60 / size=200\n\n"
              + "Confirmed: Row A (setBrushSizeForce) corrupts sampled tips; Rows B/C/D preserve tip integrity.\n"
              + "Script uses Row B (currentToolOptions.brush.Mstr) for setBrushSize.\n"
              + "Trade-off: strokePath in CC 2019 ignores Mstr, so B/C/D strokes render at native brush size.\n"
              + "To truly change strokePath size use Tab 2 'Fit to Native' or setBrushSizeForce (corrupts tip).\n"
              + "(Closing the test document will not save it)");
    };

    var row3 = paramPanel.add("group");
    row3.add("statictext", undefined, "Color mode:");
    var COLOR_MODES = [
        { id: "palette", label: "Palette (multi-color random)" },
        { id: "random",  label: "Fully random" },
        { id: "solid",   label: "Solid (main color)" },
        { id: "family",  label: "Analogous (main color +/- HSL)" },
        { id: "mono",    label: "Monochrome (same hue, varied lightness)" }
    ];
    var colorModeDropdown = row3.add("dropdownlist", undefined, undefined);
    for (var cm = 0; cm < COLOR_MODES.length; cm++) {
        colorModeDropdown.add("item", COLOR_MODES[cm].label);
        if (COLOR_MODES[cm].id === d.colorMode) colorModeDropdown.selection = cm;
    }
    if (!colorModeDropdown.selection) colorModeDropdown.selection = 0;

    var row3b = paramPanel.add("group");
    row3b.add("statictext", undefined, "Main color:");
    var mainColorSwatch = makeColorSwatch(row3b, d.mainColor || DEFAULTS.mainColor);
    mainColorSwatch.group.helpTip = "Used by Solid / Analogous / Monochrome modes";
    var editPaletteBtn = row3b.add("button", undefined, "Edit Palette...");
    editPaletteBtn.onClick = function () {
        var newPalette = editPalette(d.palette);
        if (newPalette) d.palette = newPalette;
    };

    // ---- Distribution (Tab 1) ----
    var distPanel = tab1.add("panel", undefined, "Distribution");
    distPanel.orientation = "column";
    distPanel.alignChildren = "fill";
    distPanel.margins = 12;
    distPanel.spacing = 4;

    function makeSliderRow(parent, labelText, value, min, max, suffix, helpTip) {
        var g = parent.add("group");
        g.alignChildren = "center";
        var lab = g.add("statictext", undefined, labelText);
        lab.preferredSize = [90, 20];
        var sld = g.add("slider", undefined, value, min, max);
        sld.preferredSize = [240, 18];
        var valLab = g.add("statictext", undefined, value + suffix);
        valLab.preferredSize = [60, 20];
        if (helpTip) { lab.helpTip = helpTip; sld.helpTip = helpTip; }
        sld.onChanging = function () { valLab.text = Math.round(sld.value) + suffix; };
        sld.__updateLabel = function () { valLab.text = Math.round(sld.value) + suffix; };
        return sld;
    }

    var paddingHint = distPanel.add("statictext", undefined, "\u2139 Padding auto-calculated from max brush size to avoid edge clipping.");
    paddingHint.helpTip = "Padding = brush radius + 4px buffer\nY jitter is also clamped to canvas top/bottom bounds";
    var xJitterSlider = makeSliderRow(distPanel, "X Jitter:",
        (d.xJitterPct != null ? d.xJitterPct : DEFAULTS.xJitterPct), 0, 50, "%",
        "Random X offset per slot (% of slot width; 0=uniform, 50=can fill entire slot)");
    var yJitterSlider = makeSliderRow(distPanel, "Y Jitter:",
        (d.yJitterPct != null ? d.yJitterPct : DEFAULTS.yJitterPct), 0, 50, "%",
        "Y offset relative to canvas height (0=horizontal center line, 50=can reach top/bottom edges)");

    // Cross-cell options: fixed coords / fixed size / draw probability
    var crossCellGroup = distPanel.add("group");
    crossCellGroup.alignChildren = "center";
    var fixedCoordsCb = crossCellGroup.add("checkbox", undefined, "Fixed Coords");
    fixedCoordsCb.value = !!d.fixedCoords;
    fixedCoordsCb.helpTip = "All cells share one random coordinate template.\nCombine with low draw probability for a flickering / sparkling effect.";
    var fixedSizeCb = crossCellGroup.add("checkbox", undefined, "Fixed Size");
    fixedSizeCb.value = !!d.fixedSize;
    fixedSizeCb.helpTip = "All cells share one random size template";
    var randomRotateCb = crossCellGroup.add("checkbox", undefined, "Random Rotate");
    randomRotateCb.value = !!d.randomRotate;
    randomRotateCb.helpTip =
        "Each stroke rotates randomly 0-360 degrees.\n" +
        "Implemented via temp layer rotate - tip texture is preserved.\n" +
        "With Fixed Size enabled, rotation angles are also shared across all cells.";
    var allowUpscaleCb = crossCellGroup.add("checkbox", undefined, "Allow Upscale");
    allowUpscaleCb.value = !!d.allowUpscale;
    allowUpscaleCb.helpTip =
        "Script probes actual stroke output size (actualPx) then scales to target %.\n" +
        "Downscale = sharp; upscale = bicubic interpolation, slightly blurry.\n" +
        "Default OFF: target larger than actualPx is clamped to actualPx for sharpest output.\n" +
        "Enable to force exact % scaling even when it upscales small tips (may blur).";

    var probSlider = makeSliderRow(distPanel, "Draw Probability:",
        (d.drawProbability != null ? d.drawProbability : DEFAULTS.drawProbability), 0, 100, "%",
        "Each stroke rolls independently: drawn if below this probability, skipped otherwise.\n100% = always draw; 40% = ~60% chance to skip each stroke; useful for sparkle/twinkle effects.\nFirst cell also uses probability, so the whole image is truly random.");

    // Tab 1 generate button
    var tab1BtnRow = tab1.add("group");
    tab1BtnRow.alignment = "right";
    var okBtn = tab1BtnRow.add("button", undefined, "Generate (Multi-Stroke)");

    // ===================== Tab 2 content =====================
    var t2Panel = tab2.add("panel", undefined, "Single Stroke Parameters");
    t2Panel.orientation = "column";
    t2Panel.alignChildren = "left";
    t2Panel.margins = 12;
    t2Panel.spacing = 6;

    var t2Hint = t2Panel.add("statictext", undefined,
        "\u2139 One stroke per cell, centered. Stroke size = min(cell width, height).",
        { multiline: true });
    t2Hint.preferredSize = [700, 18];

    // Grid settings (Tab 2 independent)
    var t2Row1 = t2Panel.add("group");
    t2Row1.add("statictext", undefined, "Grid:");
    var t2GridDropdown = t2Row1.add("dropdownlist", undefined, undefined);
    for (var t2gi = 0; t2gi < GRID_OPTIONS.length; t2gi++) t2GridDropdown.add("item", GRID_OPTIONS[t2gi].label);
    var t2State = (d.tab2 && typeof d.tab2 === "object") ? d.tab2 : {};
    var t2InitCols = t2State.gridCols != null ? t2State.gridCols : (d.gridCols || DEFAULTS.gridCols);
    var t2InitRows = t2State.gridRows != null ? t2State.gridRows : (d.gridRows || DEFAULTS.gridRows);
    var t2GridColsInput = t2Row1.add("edittext", undefined, t2InitCols);
    t2GridColsInput.characters = 3;
    t2Row1.add("statictext", undefined, "×");
    var t2GridRowsInput = t2Row1.add("edittext", undefined, t2InitRows);
    t2GridRowsInput.characters = 3;
    (function () {
        var matched = 0;
        for (var t2gj = 1; t2gj < GRID_OPTIONS.length; t2gj++) {
            if (GRID_OPTIONS[t2gj].cols === t2InitCols && GRID_OPTIONS[t2gj].rows === t2InitRows) { matched = t2gj; break; }
        }
        t2GridDropdown.selection = matched;
    })();
    t2GridDropdown.onChange = function () {
        var opt = GRID_OPTIONS[t2GridDropdown.selection.index];
        if (opt.cols > 0 && opt.rows > 0) {
            t2GridColsInput.text = opt.cols;
            t2GridRowsInput.text = opt.rows;
        }
    };
    function t2SyncDropdownFromInputs() {
        var c = parseInt(t2GridColsInput.text) || 0;
        var r = parseInt(t2GridRowsInput.text) || 0;
        var hit = 0;
        for (var t2gk = 1; t2gk < GRID_OPTIONS.length; t2gk++) {
            if (GRID_OPTIONS[t2gk].cols === c && GRID_OPTIONS[t2gk].rows === r) { hit = t2gk; break; }
        }
        t2GridDropdown.selection = hit;
    }
    t2GridColsInput.onChanging = t2SyncDropdownFromInputs;
    t2GridRowsInput.onChanging = t2SyncDropdownFromInputs;

    // Color mode
    var t2Row2 = t2Panel.add("group");
    t2Row2.add("statictext", undefined, "Color mode:");
    var t2ColorModeDropdown = t2Row2.add("dropdownlist", undefined, undefined);
    var t2InitColorMode = t2State.colorMode || d.colorMode;
    for (var t2cm = 0; t2cm < COLOR_MODES.length; t2cm++) {
        t2ColorModeDropdown.add("item", COLOR_MODES[t2cm].label);
        if (COLOR_MODES[t2cm].id === t2InitColorMode) t2ColorModeDropdown.selection = t2cm;
    }
    if (!t2ColorModeDropdown.selection) t2ColorModeDropdown.selection = 0;

    // Main color + edit palette
    var t2Row3 = t2Panel.add("group");
    t2Row3.add("statictext", undefined, "Main color:");
    var t2InitMainColor = t2State.mainColor || d.mainColor || DEFAULTS.mainColor;
    var t2MainColorSwatch = makeColorSwatch(t2Row3, t2InitMainColor);
    t2MainColorSwatch.group.helpTip = "Used by Solid / Analogous / Monochrome modes";
    var t2EditPaletteBtn = t2Row3.add("button", undefined, "Edit Palette...");
    t2EditPaletteBtn.onClick = function () {
        var newPalette = editPalette(d.palette);
        if (newPalette) d.palette = newPalette;
    };

    // Draw probability
    var t2InitProb = t2State.drawProbability != null ? t2State.drawProbability : (d.drawProbability != null ? d.drawProbability : DEFAULTS.drawProbability);
    var t2ProbSlider = makeSliderRow(t2Panel, "Draw Probability:", t2InitProb, 0, 100, "%",
        "Per-cell draw decision; use for sparkle / twinkle effects.");

    // Lit-cell distribution mode (avoid clumping with independent random)
    var T2_DIST_MODES = [
        { id: "independent", label: "Independent (most natural, may clump)" },
        { id: "quota",       label: "Quota Shuffle (exact count, random positions)" },
        { id: "stratified",  label: "Stratified (balanced per row, most even)" }
    ];
    var t2DistRow = t2Panel.add("group");
    t2DistRow.add("statictext", undefined, "Distribution:");
    var t2DistDropdown = t2DistRow.add("dropdownlist", undefined, undefined);
    var t2InitMode = t2State.probabilityMode || "quota";
    for (var t2dm = 0; t2dm < T2_DIST_MODES.length; t2dm++) {
        t2DistDropdown.add("item", T2_DIST_MODES[t2dm].label);
        if (T2_DIST_MODES[t2dm].id === t2InitMode) t2DistDropdown.selection = t2dm;
    }
    if (!t2DistDropdown.selection) t2DistDropdown.selection = 1;  // default quota
    t2DistDropdown.helpTip = "When probability < 100%, how to decide which cells are drawn:\n" +
        "\u00b7 Independent: each cell rolls separately, most natural but can clump\n" +
        "\u00b7 Quota Shuffle: fix total lit count (e.g. 4x4x35% = 6) then distribute randomly; exact count\n" +
        "\u00b7 Stratified: distribute lit cells evenly across rows; best for 4x4 / 2x4 grids";

    // Fit-to-cell: scale each stroke to N% of cell short-side based on actual bounds (recommended)
    var t2FitRow = t2Panel.add("group");
    t2FitRow.alignChildren = "center";
    var t2FitToCellCb = t2FitRow.add("checkbox", undefined, "Fit to Cell");
    t2FitToCellCb.value = (t2State.fitToCell != null) ? !!t2State.fitToCell : !!DEFAULTS.fitToCell;
    t2FitRow.add("statictext", undefined, "  Target % of cell short-side:");
    var t2FitPctInput = t2FitRow.add("edittext", undefined,
        (t2State.fitToCellPct != null) ? t2State.fitToCellPct : DEFAULTS.fitToCellPct);
    t2FitPctInput.characters = 4;
    t2FitRow.add("statictext", undefined, "%");
    t2FitToCellCb.helpTip =
        "Recommended: after each stroke, measure actual bounds (not brush preset Dmtr),\n" +
        "scale max(bw,bh) to the specified % of cell short-side.\n" +
        "Benefit: ignores PS toolbar brush size changes between brushes; output size is stable.\n" +
        "When enabled, the Fit to Native option below is disabled.";

    // Fit to native size (legacy path; only active when fitToCell is off)
    var t2ClampRow = t2Panel.add("group");
    t2ClampRow.alignChildren = "center";
    var t2ClampNativeCb = t2ClampRow.add("checkbox", undefined, "Fit to Native Size (prevent stretching)");
    t2ClampNativeCb.value = (t2State.clampToNative != null) ? !!t2State.clampToNative : true;
    t2ClampNativeCb.helpTip =
        "Sampled-tip brushes store a fixed-resolution bitmap internally (typically 50-300px).\n" +
        "Forcing the diameter to 256/512 causes PS to stretch the tip bitmap upward,\n" +
        "often degrading it to a blurry soft-round -- this is why export differs from the preview.\n\n" +
        "When enabled: each brush stroke is clamped to that brush's native diameter (origDmtr),\n" +
        "rendering the tip bitmap at design resolution for sharpest output; grid may have margins.\n" +
        "Disable to restore the legacy fill-cell behaviour, suitable only for hard-round / vector brushes.";
    var t2ClampHint = t2Panel.add("statictext", undefined,
        "\u2139 Recommended ON; if a brush appears too small, temporarily disable for that brush only.",
        { multiline: true });
    t2ClampHint.preferredSize = [700, 18];

    // fitToCell and clampNative are mutually exclusive
    function syncT2FitMode() {
        var on = !!t2FitToCellCb.value;
        t2FitPctInput.enabled = on;
        t2ClampNativeCb.enabled = !on;
        t2ClampHint.enabled = !on;
    }
    t2FitToCellCb.onClick = syncT2FitMode;
    syncT2FitMode();

    // Tab 2 generate button
    var tab2BtnRow = tab2.add("group");
    tab2BtnRow.alignment = "right";
    var t2GenBtn = tab2BtnRow.add("button", undefined, "Generate (Single Stroke)");

    // ---- Total preview ----
    var infoLabel = win.add("statictext", undefined, "");
    infoLabel.alignment = "left";
    function updateInfo() {
        if (typeof gridColsInput === "undefined" || !infoLabel) return;
        var nb = 0;
        for (var ik in selectedBrushes) if (selectedBrushes[ik]) nb++;
        var gc = parseInt(gridColsInput.text) || 1;
        var gr = parseInt(gridRowsInput.text) || 1;
        var cw = parseInt(wInput.text) || 0;
        var ch = parseInt(hInput.text) || 0;
        var W = cw * gc, H = ch * gr;
        infoLabel.text = "Will generate " + nb + " image(s)  -  " + gc + "x" + gr + " = " + (gc * gr) + " cells each  -  final size " + W + "x" + H + "px";
    }
    wInput.onChanging = updateInfo;
    hInput.onChanging = updateInfo;
    updateInfo();

    // ---- Bottom buttons ----
    var btnGroup = win.add("group");
    btnGroup.alignment = "right";
    var resetBtn = btnGroup.add("button", undefined, "Reset Defaults");
    resetBtn.onClick = function () {
        wInput.text = DEFAULTS.width;
        hInput.text = DEFAULTS.height;
        outInput.text = DEFAULTS.outputFolder;
        selectedBrushes = {};
        searchInput.text = "";
        customGroups = {};
        currentGroup = ALL_GROUP;
        refreshGroupDropdown();
        refreshDisplay();
        gridColsInput.text = DEFAULTS.gridCols;
        gridRowsInput.text = DEFAULTS.gridRows;
        syncDropdownFromInputs();
        strokeCountInput.text = DEFAULTS.strokesPerImage;
        transparentCb.value = !!DEFAULTS.transparentBg;
        bgSwatch.group.enabled = !transparentCb.value;
        scaleMinInput.text = Math.round(DEFAULTS.scaleMin * 100);
        scaleMaxInput.text = Math.round(DEFAULTS.scaleMax * 100);
        colorModeDropdown.selection = 0;
        mainColorSwatch.setRgb(DEFAULTS.mainColor);
        bgSwatch.setRgb(DEFAULTS.bgColor);
        d.palette = DEFAULTS.palette.slice();
        xJitterSlider.value = DEFAULTS.xJitterPct;  xJitterSlider.__updateLabel();
        yJitterSlider.value = DEFAULTS.yJitterPct;  yJitterSlider.__updateLabel();
        fixedCoordsCb.value = !!DEFAULTS.fixedCoords;
        fixedSizeCb.value = !!DEFAULTS.fixedSize;
        randomRotateCb.value = !!DEFAULTS.randomRotate;
        allowUpscaleCb.value = !!DEFAULTS.allowUpscale;
        probSlider.value = DEFAULTS.drawProbability;  probSlider.__updateLabel();
        // Tab 2 controls
        t2GridColsInput.text = DEFAULTS.gridCols;
        t2GridRowsInput.text = DEFAULTS.gridRows;
        t2SyncDropdownFromInputs();
        t2ColorModeDropdown.selection = 0;
        t2MainColorSwatch.setRgb(DEFAULTS.mainColor);
        t2ProbSlider.value = DEFAULTS.drawProbability;  t2ProbSlider.__updateLabel();
        t2DistDropdown.selection = 1;  // default quota
        t2ClampNativeCb.value = true;
        t2FitToCellCb.value = !!DEFAULTS.fitToCell;
        t2FitPctInput.text = DEFAULTS.fitToCellPct;
        if (typeof syncT2FitMode === "function") syncT2FitMode();
        updateInfo();
    };
    var closeBtn = btnGroup.add("button", undefined, "Close", { name: "cancel" });
    closeBtn.onClick = function () { win.close(0); };

    // Build shared base cfg (fields common to both tabs)
    function buildSharedCfg() {
        var brushes = [];
        for (var bk in selectedBrushes) { if (selectedBrushes[bk]) brushes.push(bk); }
        if (brushes.length === 0) { alert("Please check at least one brush"); return null; }
        if (!outInput.text) { alert("Please specify an output folder"); return null; }
        return {
            width: parseInt(wInput.text) || 1024,
            height: parseInt(hInput.text) || 1024,
            outputFolder: outInput.text.replace(/\\/g, "/"),
            brushNames: brushes,
            palette: d.palette,
            bgColor: bgSwatch.getRgb(),
            transparentBg: transparentCb.value,
            customGroups: customGroups
        };
    }

    // Tab 1: multi-stroke random distribution
    okBtn.onClick = function () {
        var cfg = buildSharedCfg();
        if (!cfg) return;
        cfg.gridCols = Math.max(1, parseInt(gridColsInput.text) || 1);
        cfg.gridRows = Math.max(1, parseInt(gridRowsInput.text) || 1);
        cfg.strokesPerImage = parseInt(strokeCountInput.text) || 20;
        // Tab 1 uses relative scale: sizeMin/Max computed dynamically per brush
        cfg.useScaleMode = true;
        var sMinPct = parseInt(scaleMinInput.text);
        var sMaxPct = parseInt(scaleMaxInput.text);
        if (isNaN(sMinPct)) sMinPct = Math.round(DEFAULTS.scaleMin * 100);
        if (isNaN(sMaxPct)) sMaxPct = Math.round(DEFAULTS.scaleMax * 100);
        cfg.scaleMin = Math.max(1, sMinPct) / 100;
        cfg.scaleMax = Math.max(1, sMaxPct) / 100;
        if (cfg.scaleMin > cfg.scaleMax) {
            var tmpScale = cfg.scaleMin; cfg.scaleMin = cfg.scaleMax; cfg.scaleMax = tmpScale;
        }
        cfg.colorMode = COLOR_MODES[colorModeDropdown.selection.index].id;
        cfg.mainColor = mainColorSwatch.getRgb();
        cfg.xJitterPct = Math.round(xJitterSlider.value);
        cfg.yJitterPct = Math.round(yJitterSlider.value);
        cfg.fixedCoords = fixedCoordsCb.value;
        cfg.fixedSize = fixedSizeCb.value;
        cfg.randomRotate = randomRotateCb.value;
        cfg.drawProbability = Math.round(probSlider.value);
        cfg.allowUpscale = allowUpscaleCb.value;
        // Persist (keep Tab 2 sub-key)
        var toSave = cloneObj(cfg);
        toSave.tab2 = (d.tab2 && typeof d.tab2 === "object") ? d.tab2 : {};
        saveConfig(toSave);
        d.tab2 = toSave.tab2;  // for next session
        runAndKeepOpen(cfg);
    };

    // Tab 2: single stroke per cell, centered
    t2GenBtn.onClick = function () {
        var cfg = buildSharedCfg();
        if (!cfg) return;
        var cellMin = Math.min(cfg.width, cfg.height);
        cfg.gridCols = Math.max(1, parseInt(t2GridColsInput.text) || 1);
        cfg.gridRows = Math.max(1, parseInt(t2GridRowsInput.text) || 1);
        cfg.strokesPerImage = 1;
        cfg.brushSizeMin = cellMin;
        cfg.brushSizeMax = cellMin;
        cfg.useScaleMode = false;  // Tab 2 uses absolute px + clampToNative
        cfg.colorMode = COLOR_MODES[t2ColorModeDropdown.selection.index].id;
        cfg.mainColor = t2MainColorSwatch.getRgb();
        cfg.xJitterPct = 0;
        cfg.yJitterPct = 0;
        cfg.fixedCoords = true;
        cfg.fixedSize = true;
        cfg.randomRotate = false;  // Tab 2 no random rotation
        cfg.drawProbability = Math.round(t2ProbSlider.value);
        cfg.probabilityMode = T2_DIST_MODES[t2DistDropdown.selection.index].id;
        cfg.clampToNative = t2ClampNativeCb.value;
        cfg.fitToCell = t2FitToCellCb.value;
        var fitPct = parseInt(t2FitPctInput.text);
        if (isNaN(fitPct) || fitPct <= 0) fitPct = DEFAULTS.fitToCellPct;
        if (fitPct > 200) fitPct = 200;
        cfg.fitToCellPct = fitPct;
        // Tab 2 allowUpscale: when clampToNative is off and cell > native, allow upscaling.
        // Reuses Tab 1 checkbox value. When clampToNative is on, size is already clamped so this is moot.
        cfg.allowUpscale = allowUpscaleCb.value;
        // Persist: Tab 1 fields keep last values; Tab 2 fields written to sub-key
        var toSave = cloneObj(d);
        toSave.brushNames = cfg.brushNames;
        toSave.outputFolder = cfg.outputFolder;
        toSave.width = cfg.width;
        toSave.height = cfg.height;
        toSave.bgColor = cfg.bgColor;
        toSave.transparentBg = cfg.transparentBg;
        toSave.customGroups = customGroups;
        toSave.tab2 = {
            gridCols: cfg.gridCols,
            gridRows: cfg.gridRows,
            colorMode: cfg.colorMode,
            mainColor: cfg.mainColor,
            drawProbability: cfg.drawProbability,
            probabilityMode: cfg.probabilityMode,
            clampToNative: cfg.clampToNative,
            fitToCell: cfg.fitToCell,
            fitToCellPct: cfg.fitToCellPct
        };
        saveConfig(toSave);
        d.tab2 = toSave.tab2;
        runAndKeepOpen(cfg);
    };

    // Hide main window during generation (avoids dialog context blocking executeActionGet)
    function runAndKeepOpen(cfg) {
        win.hide();
        try { runBatch(cfg); }
        catch (e) { alert("Generation failed: " + e); }
        win.show();
    }

    win.center();
    win.show();
}

// Palette editor sub-dialog
function editPalette(currentPalette) {
    var win = new Window("dialog", "Edit Palette");
    win.orientation = "column";
    win.alignChildren = "fill";
    win.margins = 16;

    win.add("statictext", undefined, "One color per line, format #RRGGBB (# is optional)");
    var box = win.add("edittext", undefined, paletteToText(currentPalette), { multiline: true });
    box.preferredSize = [320, 180];

    var btns = win.add("group");
    btns.alignment = "right";
    var cancel = btns.add("button", undefined, "Cancel", { name: "cancel" });
    var ok = btns.add("button", undefined, "OK", { name: "ok" });

    var out = null;
    ok.onClick = function () {
        var lines = box.text.split(/\r?\n/);
        var arr = [];
        for (var i = 0; i < lines.length; i++) {
            var rgb = hexToRgb(lines[i]);
            if (rgb) arr.push(rgb);
        }
        if (arr.length === 0) { alert("Please enter at least one valid color"); return; }
        out = arr;
        win.close(1);
    };
    cancel.onClick = function () { win.close(0); };
    win.show();
    return out;
}

// =====================================================================
// Batch execution
// =====================================================================
function runBatch(C) {
    var folder = new Folder(C.outputFolder);
    if (!folder.exists) folder.create();

    var grid = { cols: Math.max(1, C.gridCols || 1), rows: Math.max(1, C.gridRows || 1) };
    var cellsPerImage = grid.cols * grid.rows;
    var totalPlanned = C.brushNames.length;  // one composite image per brush
    var totalDone = 0;
    var failedBrushes = [];
    var sizeWarnings = [];  // brushes whose native Dmtr could not be read

    // Progress palette
    var pw = new Window("palette", "Generating...");
    pw.orientation = "column";
    pw.alignChildren = "fill";
    pw.margins = 12;
    var label = pw.add("statictext", undefined, "Preparing...");
    label.preferredSize = [380, 20];
    var bar = pw.add("progressbar", undefined, 0, totalPlanned);
    bar.preferredSize = [380, 16];
    var subLabel = pw.add("statictext", undefined, "");
    subLabel.preferredSize = [380, 18];
    pw.center();
    pw.show();

    // Suppress dialogs + lock pixel units (prevent user unit prefs from misinterpreting sizes)
    var oldDisplayDialogs = app.displayDialogs;
    var oldRulerUnits = app.preferences.rulerUnits;
    var oldTypeUnits = app.preferences.typeUnits;
    app.displayDialogs = DialogModes.NO;
    app.preferences.rulerUnits = Units.PIXELS;
    app.preferences.typeUnits = TypeUnits.PIXELS;

    var startTime = new Date().getTime();

    // Grid dimensions (cell size, total canvas): independent of brush size, computed once.
    // Padding / slot / jitter (horizontal-centerline distribution params) depend on each
    // brush's max effective size, so computed per brush inside the loop (computeLayoutForBrush).
    var cellW = C.width;
    var cellH = C.height;
    var bigW = cellW * grid.cols;
    var bigH = cellH * grid.rows;

    // Given this brush's maximum possible stroke size, compute layout parameters.
    function computeLayoutForBrush(maxStrokePx) {
        var maxMarginX = Math.floor(cellW * 0.45);
        var maxMarginY = Math.floor(cellH * 0.45);
        var marginPx = Math.ceil(maxStrokePx / 2) + 4;
        var paddingPx = Math.min(marginPx, maxMarginX);
        var safeBandLimit = Math.max(0, Math.floor(cellH / 2) - Math.min(marginPx, maxMarginY));
        var usableW = Math.max(1, cellW - 2 * paddingPx);
        var slotW = usableW / C.strokesPerImage;
        var xJitter = Math.floor(slotW * (C.xJitterPct || 0) / 100);
        var bandHeight = Math.floor(cellH * (C.yJitterPct || 0) / 100);
        if (bandHeight > safeBandLimit) bandHeight = safeBandLimit;
        return { paddingPx: paddingPx, slotW: slotW, xJitter: xJitter, bandHeight: bandHeight };
    }

    for (var b = 0; b < C.brushNames.length; b++) {
        var brushName = C.brushNames[b];

        // Test whether the brush exists (use a small temp doc to avoid accidentally creating a full canvas)
        var brushOK = true;
        try {
            var testDoc = createBlankDoc(C, cellW, cellH);
            selectBrushByName(brushName);
            testDoc.close(SaveOptions.DONOTSAVECHANGES);
        } catch (e) {
            brushOK = false;
            failedBrushes.push(brushName);
            try { app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
        if (!brushOK) {
            totalDone++;
            bar.value = totalDone;
            continue;
        }

        label.text = "[" + (b + 1) + "/" + C.brushNames.length + "] " + brushName;
        subLabel.text = "  Grid " + grid.cols + "x" + grid.rows + "  -  Done " + totalDone + "/" + totalPlanned;
        pw.update();

        // Create the composite canvas
        var doc = createBlankDoc(C, bigW, bigH);
        try { selectBrushByName(brushName); }
        catch (e) {
            doc.close(SaveOptions.DONOTSAVECHANGES);
            if (failedBrushes.indexOf(brushName) === -1) failedBrushes.push(brushName);
            totalDone++;
            bar.value = totalDone;
            continue;
        }

        // Record original preset diameter; restored after drawing to avoid polluting the brush library
        var origDmtr = getCurrentBrushSize();  // readable after CC 2019 dialog close

        // No longer calling setBrushSize to change brush preset Dmtr (would corrupt sampled tips).
        // Size/rotation changes are handled by drawStrokeTransformed via temp layer geometry, tip stays intact.
        var allowUpscale = !!C.allowUpscale;

        // ---------- Cell-short-side mode (Tab 1 useScaleMode + Tab 2 fitToCell shared path) ----------
        // Both paths: probe once to get actual output size (actualPx), use a temp doc of actualPx*1.2,
        // draw full stroke -> scale to target % -> rotate -> translate to (x,y) -> duplicate to main canvas -> merge.
        // Does not depend on origDmtr or PS toolbar brush size; output dimensions are stable.
        var useFitTo = C.useScaleMode || C.fitToCell;
        var cellShortSide = Math.min(cellW, cellH);
        var fitTmpDocSize = 0;
        // Tab 2: single fixed ratio; Tab 1: use max of range for temp doc size
        var fitTargetPx = 0;
        if (C.fitToCell) {
            var fitPctVal = (C.fitToCellPct != null) ? C.fitToCellPct : 95;
            fitTargetPx = Math.round(cellShortSide * (fitPctVal / 100));
            if (fitTargetPx < 1) fitTargetPx = 1;
        }
        if (useFitTo) {
            // probe: draw one stroke in large space to measure real size; origDmtr is fallback only
            var probedPx = 0;
            try { probedPx = probeBrushOutputSize(C); } catch (eP) { probedPx = 0; }
            if (probedPx <= 0) probedPx = (origDmtr > 0 ? origDmtr : cellShortSide);
            // temp doc must fit full stroke + margin; floor 1024 ensures small strokes are measurable
            fitTmpDocSize = Math.ceil(probedPx * 1.2);
            if (fitTmpDocSize < 1024) fitTmpDocSize = 1024;
            if (fitTmpDocSize > 16384) fitTmpDocSize = 16384;
        }

        // Compute per-stroke size range for this brush.
        // - useScaleMode (Tab 1): scaleMin/Max = ratio vs cell short-side, used directly
        // - otherwise (Tab 2 legacy path): brushSizeMin/Max are absolute px targets, need origDmtr to derive ratio
        // ratioMin/ratioMax only used by drawStrokeTransformed legacy path;
        // useFitTo path ignores them, uses sizeMinPx/sizeMaxPx as target pixels instead.
        var ratioMin, ratioMax, estMaxPx;
        var sizeMinPx, sizeMaxPx;  // Tab 1 cell-short-side mode target pixels
        if (C.useScaleMode) {
            var pctMin = (C.scaleMin != null) ? C.scaleMin : 0.3;
            var pctMax = (C.scaleMax != null) ? C.scaleMax : 0.8;
            if (pctMin <= 0) pctMin = 0.01;
            if (pctMax < pctMin) pctMax = pctMin;
            // cell-short-side mode: scaleMin/Max are ratios vs cell short-side
            sizeMinPx = Math.max(1, Math.round(cellShortSide * pctMin));
            sizeMaxPx = Math.max(sizeMinPx, Math.round(cellShortSide * pctMax));
            // compat fields (only used when useFitTo=false, which is the normal case here)
            ratioMin = pctMin;
            ratioMax = pctMax;
            estMaxPx = sizeMaxPx;
        } else {
            // Tab 2 path: brushSizeMin/Max are absolute px targets
            var sMinPx = C.brushSizeMin;
            var sMaxPx = C.brushSizeMax;
            if (C.clampToNative && origDmtr > 0) {
                if (sMinPx > origDmtr) sMinPx = origDmtr;
                if (sMaxPx > origDmtr) sMaxPx = origDmtr;
                if (sMinPx < 1) sMinPx = 1;
                if (sMaxPx < sMinPx) sMaxPx = sMinPx;
            }
            estMaxPx = sMaxPx;
            if (origDmtr > 0) {
                ratioMin = sMinPx / origDmtr;
                ratioMax = sMaxPx / origDmtr;
            } else {
                // origDmtr unreadable: cannot control target px precisely, output at native size
                ratioMin = 1.0;
                ratioMax = 1.0;
            }
        }

        // Compute distribution padding based on this brush's max effective size (prevent edge clipping)
        var layout = computeLayoutForBrush(estMaxPx);
        var paddingPx = layout.paddingPx;
        var slotW = layout.slotW;
        var xJitter = layout.xJitter;
        var bandHeight = layout.bandHeight;

        // Pre-generate stroke templates for this brush: one set (dx, dy, ratio, sizePx, rot) per stroke index.
        // When Fixed Coords / Fixed Size is on, all cells share one template; otherwise each cell is independent.
        var randomRotate = !!C.randomRotate;
        var templates = [];
        for (var ts = 0; ts < C.strokesPerImage; ts++) {
            templates.push({
                dx: xJitter > 0 ? randInt(-xJitter, xJitter) : 0,
                dy: bandHeight > 0 ? randInt(-bandHeight, bandHeight) : 0,
                ratio: ratioMin + Math.random() * (ratioMax - ratioMin),
                sizePx: C.useScaleMode
                    ? Math.round(sizeMinPx + Math.random() * (sizeMaxPx - sizeMinPx))
                    : 0,
                rot: randomRotate ? Math.random() * 360 : 0
            });
        }
        var probability = (C.drawProbability != null) ? C.drawProbability : 100;

        // Probability distribution mode: when not "independent", pre-build a cell draw mask.
        // quota / stratified avoid local clumping that independent random can produce (especially 4x4 / 2x4 grids).
        var cellMask = null;
        if (probability < 100 && C.probabilityMode && C.probabilityMode !== "independent") {
            cellMask = buildCellDrawMask(grid.cols, grid.rows, probability, C.probabilityMode);
        }

        // Distribute strokes along the horizontal centerline within each cell
        for (var gr = 0; gr < grid.rows; gr++) {
            for (var gc = 0; gc < grid.cols; gc++) {
                var cellIdx = gr * grid.cols + gc;
                // Cell mask says skip: skip all strokes in this cell
                if (cellMask !== null && !cellMask[cellIdx]) continue;

                var offsetX = gc * cellW;
                var offsetY = gr * cellH;
                var cellYCenter = offsetY + Math.floor(cellH / 2);
                for (var s = 0; s < C.strokesPerImage; s++) {
                    // No mask: each stroke rolls independently
                    if (cellMask === null && probability < 100 && (Math.random() * 100) >= probability) continue;

                    var t = templates[s];
                    var dx = C.fixedCoords ? t.dx : (xJitter > 0 ? randInt(-xJitter, xJitter) : 0);
                    var dy = C.fixedCoords ? t.dy : (bandHeight > 0 ? randInt(-bandHeight, bandHeight) : 0);
                    var ratio = C.fixedSize ? t.ratio : (ratioMin + Math.random() * (ratioMax - ratioMin));
                    var rot   = randomRotate ? (C.fixedSize ? t.rot : Math.random() * 360) : 0;
                    // Tab 1 cell-short-side mode target px: Fixed Size uses template, otherwise random per stroke
                    var thisSizePx = C.useScaleMode
                        ? (C.fixedSize ? t.sizePx
                                       : Math.round(sizeMinPx + Math.random() * (sizeMaxPx - sizeMinPx)))
                        : 0;

                    setForegroundColor(C);
                    var xCenter = paddingPx + (s + 0.5) * slotW;
                    var x = Math.round(offsetX + xCenter + dx);
                    if (x < offsetX) x = offsetX;
                    else if (x > offsetX + cellW) x = offsetX + cellW;
                    var y = cellYCenter + dy;

                    if (useFitTo) {
                        // Shared path: draw in large temp doc -> scale to target px -> rotate -> translate to (x,y) -> merge
                        // - Tab 1 useScaleMode: target px from sizeMinPx/sizeMaxPx (cell-short-side mode)
                        // - Tab 2 fitToCell:   target px = fitTargetPx (cell short-side * fitToCellPct)
                        var tgt = C.useScaleMode ? thisSizePx : fitTargetPx;
                        drawStrokeFitTo(C, x, y, tgt, fitTmpDocSize, rot, allowUpscale);
                    } else {
                        // Legacy path: draw to temp layer -> scale by ratio + rotate -> merge.
                        // Only used when Tab 2 fitToCell is off and useScaleMode is off (absolute px, requires origDmtr).
                        drawStrokeTransformed(C, x, y, ratio, rot, allowUpscale);
                    }
                }
            }
        }

        var filename = sanitize(brushName) + "_" + grid.cols + "x" + grid.rows + ".png";
        try { savePNG(doc, C.outputFolder + "/" + filename); }
        catch (e) { /* ignore single-image save error */ }
        doc.close(SaveOptions.DONOTSAVECHANGES);

        // useFitTo path: after image is done, preset brush size to DRAW_SIZE_RESET (default 512).
        // This lets the next selectBrushByName inherit a larger starting Dmtr (PS CC 2019 behaviour),
        // so the probe measures a meaningful actual output size and avoids small sampled tips
        // (10-30px default) clamping fitTmpDocSize to the 1024 floor causing oversized ratios and blurry output.
        // Must be called after doc.close: calling setBrushSizeForce mid-draw corrupts the current tip.
        if (useFitTo) {
            try { setBrushSizeForce(DRAW_SIZE_RESET); } catch (eRst) {}
        }

        // No need to restore brush preset diameter: new drawing path does not write Brsh.Dmtr.
        // Warning recorded only when using legacy drawStrokeTransformed path (Tab 2, fitToCell off,
        // useScaleMode off) AND origDmtr is unreadable -- ratio degrades to 1.0, drawn at PS current size.
        // useFitTo paths (Tab 1 / Tab 2 fitToCell) do not depend on origDmtr, no warning needed.
        if (!useFitTo && origDmtr <= 0) sizeWarnings.push(brushName);

        totalDone++;
        bar.value = totalDone;
    }

    // Restore PS unit prefs (resetBrushPresets not called, to avoid clearing user's custom brushes)
    app.displayDialogs = oldDisplayDialogs;
    app.preferences.rulerUnits = oldRulerUnits;
    app.preferences.typeUnits = oldTypeUnits;
    pw.close();

    var elapsed = ((new Date().getTime() - startTime) / 1000).toFixed(1);
    var msg = "Done! Generated " + totalDone + " image(s)  (" + elapsed + "s)\n\nSaved to: " + C.outputFolder;
    if (failedBrushes.length > 0) {
        msg += "\n\nWarning - brushes not found (skipped):\n  " + failedBrushes.join("\n  ");
    }
    if (sizeWarnings.length > 0) {
        msg += "\n\nWarning - native Dmtr unreadable for these brushes; scale (Tab 1) and fit-native (Tab 2) fell back to cell-size estimate:\n  "
             + sizeWarnings.join("\n  ");
    }
    if (confirm(msg + "\n\nOpen output folder?")) {
        new Folder(C.outputFolder).execute();
    }
}

// =====================================================================
// Photoshop low-level utilities
// =====================================================================
function createBlankDoc(C, w, h) {
    var width = w || C.width;
    var height = h || C.height;
    if (C.transparentBg) {
        // True transparent background: single transparent layer, no fill, no flatten; PNG preserves alpha
        return app.documents.add(width, height, 72, "brush_batch", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
    }
    var fillType = (C.bgColor[0] === 255 && C.bgColor[1] === 255 && C.bgColor[2] === 255)
        ? DocumentFill.WHITE : DocumentFill.TRANSPARENT;
    var doc = app.documents.add(width, height, 72, "brush_batch", NewDocumentMode.RGB, fillType);
    if (fillType === DocumentFill.TRANSPARENT) {
        var bg = new SolidColor();
        bg.rgb.red = C.bgColor[0]; bg.rgb.green = C.bgColor[1]; bg.rgb.blue = C.bgColor[2];
        doc.selection.selectAll();
        doc.selection.fill(bg);
        doc.selection.deselect();
        doc.flatten();
    }
    return doc;
}

function selectBrushByName(name) {
    app.currentTool = "paintbrushTool";
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putName(stringIDToTypeID("brush"), name);
    desc.putReference(charIDToTypeID("null"), ref);
    executeAction(charIDToTypeID("slct"), desc, DialogModes.NO);
}

function setBrushSize(px) {
    // Safe mode: write currentToolOptions.brush.Mstr (= toolbar brush size slider value).
    //
    // Do NOT setd Brsh.* -- testing on CC 2019 shows that setd on any Brsh descriptor attribute
    // (Mstr or Dmtr) degrades sampled-tip brushes to the default soft-round
    // (PS treats the action as "preset modified" -> discards sample tip -> reverts to round base).
    //
    // Visual test confirmed: path B (currentToolOptions) preserves sampled tip integrity.
    //
    // Side effect: strokePath in CC 2019 still renders at the brush preset's Dmtr,
    // so this function does not truly change strokePath output size; it only keeps the tip intact.
    // To forcibly change strokePath render size (accepting tip corruption), call setBrushSizeForce.
    try {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
        r.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        d.putReference(charIDToTypeID("null"), r);

        var brushDesc = new ActionDescriptor();
        brushDesc.putUnitDouble(charIDToTypeID("Mstr"), charIDToTypeID("#Pxl"), px);

        var toolDesc = new ActionDescriptor();
        toolDesc.putObject(stringIDToTypeID("brush"), stringIDToTypeID("brush"), brushDesc);

        d.putObject(charIDToTypeID("T   "), stringIDToTypeID("currentToolOptions"), toolDesc);
        executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
        return "";
    } catch (e) { return "toolOptions:" + e; }
}

// Destructive version: directly setd Brsh.Mstr and Brsh.Dmtr.
// Pro: strokePath truly renders at the target size.
// Con: corrupts the sample tip bitmap of sampled-tip brushes, degrading them to the default soft-round.
// Use only when you explicitly accept tip corruption (e.g. hard-round/geometric brushes, or willing to reselect each time).
function setBrushSizeForce(px) {
    var errs = [];
    try {
        var idBrsh = charIDToTypeID("Brsh");
        var d1 = new ActionDescriptor();
        var r1 = new ActionReference();
        r1.putEnumerated(idBrsh, charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        d1.putReference(charIDToTypeID("null"), r1);
        var p1 = new ActionDescriptor();
        p1.putUnitDouble(charIDToTypeID("Mstr"), charIDToTypeID("#Pxl"), px);
        d1.putObject(charIDToTypeID("T   "), idBrsh, p1);
        executeAction(charIDToTypeID("setd"), d1, DialogModes.NO);
    } catch (e1) { errs.push("Mstr:" + e1); }
    try {
        var d2 = new ActionDescriptor();
        var r2 = new ActionReference();
        r2.putEnumerated(charIDToTypeID("Brsh"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        d2.putReference(charIDToTypeID("null"), r2);
        var p2 = new ActionDescriptor();
        p2.putUnitDouble(charIDToTypeID("Dmtr"), charIDToTypeID("#Pxl"), px);
        d2.putObject(charIDToTypeID("T   "), charIDToTypeID("Brsh"), p2);
        executeAction(charIDToTypeID("setd"), d2, DialogModes.NO);
    } catch (e2) { errs.push("Dmtr:" + e2); }
    return errs.length === 2 ? errs.join(" | ") : "";
}

// ========== Experimental candidate implementations: used in Visual Test button to diagnose which path preserves sampled tips ==========
// Candidate P1: write currentToolOptions.brush.Mstr (modifies paintbrush tool's brush sub-descriptor, not Brsh directly)
function _setBrushSize_toolOptions(px) {
    try {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
        r.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        d.putReference(charIDToTypeID("null"), r);

        var brushDesc = new ActionDescriptor();
        brushDesc.putUnitDouble(charIDToTypeID("Mstr"), charIDToTypeID("#Pxl"), px);

        var toolDesc = new ActionDescriptor();
        toolDesc.putObject(stringIDToTypeID("brush"), stringIDToTypeID("brush"), brushDesc);

        d.putObject(charIDToTypeID("T   "), stringIDToTypeID("currentToolOptions"), toolDesc);
        executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
    } catch (e) {}
}

// Candidate P2: write Mstr directly on paintbrushTool.brush
function _setBrushSize_paintbrushTool(px) {
    try {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putClass(stringIDToTypeID("paintbrushTool"));
        d.putReference(charIDToTypeID("null"), r);

        var brushDesc = new ActionDescriptor();
        brushDesc.putUnitDouble(charIDToTypeID("Mstr"), charIDToTypeID("#Pxl"), px);

        var toolDesc = new ActionDescriptor();
        toolDesc.putObject(stringIDToTypeID("brush"), stringIDToTypeID("brush"), brushDesc);

        d.putObject(charIDToTypeID("T   "), stringIDToTypeID("paintbrushTool"), toolDesc);
        executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
    } catch (e) {}
}

// Candidate P3: simulate keyboard shortcuts [ / ] (decreaseBrushSize / increaseBrushSize)
// These PS built-in events step brush size up/down, typically bound to [ ].
// Usage: first set to a baseline with setBrushSize, then call this N times to step.
// Here simplified: send N events directly toward target size (rough, diagnostic use only).
function _stepBrushSize_to(targetPx) {
    // read current size
    var cur = getCurrentBrushSize();
    if (cur < 0) return;
    var diff = targetPx - cur;
    var event = diff > 0 ? "increaseBrushSize" : "decreaseBrushSize";
    var steps = Math.min(200, Math.abs(diff));  // safety cap
    var idEvt = stringIDToTypeID(event);
    for (var i = 0; i < steps; i++) {
        try { executeAction(idEvt, new ActionDescriptor(), DialogModes.NO); } catch (e) { break; }
    }
}

function resetBrushPresets() {
    // Tell PS to reload the default brush library from disk, discarding any temporary Dmtr modifications
    try {
        var desc = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putProperty(charIDToTypeID("capp"), stringIDToTypeID("brush"));
        desc.putReference(charIDToTypeID("null"), ref);
        executeAction(stringIDToTypeID("reset"), desc, DialogModes.NO);
    } catch (e) {}
}

function getAllLoadedBrushes() {
    // Read names of all brush presets currently loaded in PS
    var brushes = [];
    try {
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var appDesc = executeActionGet(ref);
        var pmKey = stringIDToTypeID("presetManager");
        if (!appDesc.hasKey(pmKey)) return brushes;
        var presetList = appDesc.getList(pmKey);
        // Brush presets are typically at index 0 of the presetManager list
        var brushTypeDesc = presetList.getObjectValue(0);
        var nameKey = charIDToTypeID("Nm  ");
        if (!brushTypeDesc.hasKey(nameKey)) return brushes;
        var nameList = brushTypeDesc.getList(nameKey);
        for (var i = 0; i < nameList.count; i++) {
            brushes.push(nameList.getString(i));
        }
    } catch (e) { /* return empty array on failure */ }
    return brushes;
}

function getCurrentBrushName() {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
    ref.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var desc = executeActionGet(ref);
    var toolDesc = desc.getObjectValue(stringIDToTypeID("currentToolOptions"));
    var brushDesc = toolDesc.getObjectValue(stringIDToTypeID("brush"));
    return brushDesc.getString(charIDToTypeID("Nm  "));
}

function _readUnitOrDouble(d, key) {
    // compatible with both unitDouble and double storage types
    try { return d.getUnitDoubleValue(key); } catch (e) {}
    try { return d.getDouble(key); } catch (e) {}
    return -1;
}

function _idToString(tid) {
    try { var s = typeIDToStringID(tid); if (s) return s; } catch (e) {}
    try { return typeIDToCharID(tid); } catch (e) {}
    return "?";
}

function getBrushDescriptor() {
    // Prefer Brsh direct reference (same target as setBrushSize path A)
    try {
        var ref = new ActionReference();
        ref.putEnumerated(charIDToTypeID("Brsh"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        return { src: "Brsh", desc: executeActionGet(ref) };
    } catch (e) {}
    // Fall back to currentToolOptions.brush
    try {
        var ref2 = new ActionReference();
        ref2.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
        ref2.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var desc = executeActionGet(ref2);
        var toolDesc = desc.getObjectValue(stringIDToTypeID("currentToolOptions"));
        if (toolDesc.hasKey(stringIDToTypeID("brush"))) {
            return { src: "currentToolOptions.brush", desc: toolDesc.getObjectValue(stringIDToTypeID("brush")) };
        }
    } catch (e2) {}
    return null;
}

function getCurrentBrushSize() {
    // Try common size keys: Mstr / Dmtr / masterDiameter / diameter
    var info = getBrushDescriptor();
    if (!info) return -1;
    var d = info.desc;
    var candidates = [
        charIDToTypeID("Mstr"),
        charIDToTypeID("Dmtr"),
        stringIDToTypeID("masterDiameter"),
        stringIDToTypeID("diameter")
    ];
    for (var i = 0; i < candidates.length; i++) {
        if (d.hasKey(candidates[i])) {
            var v = _readUnitOrDouble(d, candidates[i]);
            if (v > 0) return Math.round(v);
        }
    }
    return -1;
}

function showDiagnosticDialog(title, text) {
    var w = new Window("dialog", title);
    w.orientation = "column";
    w.alignChildren = "fill";
    w.margins = 10;
    var et = w.add("edittext", undefined, text, { multiline: true, scrollable: true, readonly: false });
    et.preferredSize = [640, 420];
    var bg = w.add("group");
    bg.alignment = "right";
    var copyBtn = bg.add("button", undefined, "Select All");
    copyBtn.onClick = function () { try { et.active = true; et.textselection = text; } catch (e) {} };
    bg.add("button", undefined, "Close", { name: "ok" });
    w.show();
}

function _formatDescKeys(d, indent) {
    var pad = indent || "  ";
    var out = [];
    for (var i = 0; i < d.count; i++) {
        var k = d.getKey(i);
        var name = _idToString(k);
        var typeStr = "?";
        var val = "";
        try {
            var t = d.getType(k);
            if (t === DescValueType.UNITDOUBLE) {
                typeStr = "unitDouble";
                try { val = " = " + d.getUnitDoubleValue(k).toFixed(2); } catch (e) {}
            } else if (t === DescValueType.DOUBLETYPE) {
                typeStr = "double"; val = " = " + d.getDouble(k).toFixed(2);
            } else if (t === DescValueType.INTEGERTYPE) {
                typeStr = "int"; val = " = " + d.getInteger(k);
            } else if (t === DescValueType.BOOLEANTYPE) {
                typeStr = "bool"; val = " = " + d.getBoolean(k);
            } else if (t === DescValueType.STRINGTYPE) {
                typeStr = "string"; val = " = \"" + d.getString(k) + "\"";
            } else if (t === DescValueType.OBJECTTYPE) {
                typeStr = "object";
            }
        } catch (e) {}
        out.push(pad + name + " (" + typeStr + ")" + val);
    }
    return out.join("\n");
}

function _tryGet(label, fn) {
    try {
        var d = fn();
        if (!d) return label + ": (null)";
        return label + " [count=" + d.count + "]\n" + _formatDescKeys(d, "  ");
    } catch (e) { return label + ": ERR " + (e && e.message ? e.message : e); }
}

function probeBrushAllPaths() {
    var out = [];
    // Path 1: Brsh enum direct read
    out.push(_tryGet("[1] Brsh enum getter", function () {
        var r = new ActionReference();
        r.putEnumerated(charIDToTypeID("Brsh"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        return executeActionGet(r);
    }));
    // Path 2: app.currentToolOptions
    out.push(_tryGet("[2] app.currentToolOptions", function () {
        var r = new ActionReference();
        r.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
        r.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        return executeActionGet(r);
    }));
    // Path 3: app.currentToolOptions -> brush sub-object
    out.push(_tryGet("[3] app.currentToolOptions.brush", function () {
        var r = new ActionReference();
        r.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("currentToolOptions"));
        r.putEnumerated(charIDToTypeID("capp"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        var d = executeActionGet(r);
        var to = d.getObjectValue(stringIDToTypeID("currentToolOptions"));
        return to.getObjectValue(stringIDToTypeID("brush"));
    }));
    // Path 4: paintbrushTool enum
    out.push(_tryGet("[4] paintbrushTool enum getter", function () {
        var r = new ActionReference();
        r.putEnumerated(stringIDToTypeID("paintbrushTool"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
        return executeActionGet(r);
    }));
    return out.join("\n");
}

function dumpBrushKeys() {
    var info = getBrushDescriptor();
    if (!info) return "(Cannot retrieve brush descriptor)";
    return info.src + " top-level keys:\n" + _formatDescKeys(info.desc, "  ");
}

function setForegroundColor(C) {
    var rgb = pickColorByMode(C);
    var c = new SolidColor();
    c.rgb.red = rgb[0]; c.rgb.green = rgb[1]; c.rgb.blue = rgb[2];
    app.foregroundColor = c;
}

function pickColorByMode(C) {
    var mode = C.colorMode;
    var main = C.mainColor || [255, 107, 107];
    if (mode === "palette" && C.palette && C.palette.length > 0) {
        var p = C.palette[randInt(0, C.palette.length - 1)];
        return [p[0], p[1], p[2]];
    }
    if (mode === "solid") {
        return [main[0], main[1], main[2]];
    }
    if (mode === "family") {
        // Analogous: hue +/-15 degrees, saturation/lightness +/-0.15
        var hsl = rgbToHsl(main[0], main[1], main[2]);
        var h = (hsl[0] + (Math.random() - 0.5) * 30 + 360) % 360;
        var s2 = clamp01(hsl[1] + (Math.random() - 0.5) * 0.3);
        var l2 = clamp01(hsl[2] + (Math.random() - 0.5) * 0.3);
        return hslToRgb(h, s2, l2);
    }
    if (mode === "mono") {
        // Monochrome: keep main color hue + saturation, vary lightness widely
        var hsl3 = rgbToHsl(main[0], main[1], main[2]);
        var lMono = 0.2 + Math.random() * 0.6;  // 0.2 ~ 0.8
        return hslToRgb(hsl3[0], hsl3[1], lMono);
    }
    // random fallback
    return [randInt(0, 255), randInt(0, 255), randInt(0, 255)];
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h, s, l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = ((b - r) / d + 2);
        else h = ((r - g) / d + 4);
        h *= 60;
    }
    return [h, s, l];
}

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp01(s); l = clamp01(l);
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var r1, g1, b1;
    if (h < 60)       { r1 = c; g1 = x; b1 = 0; }
    else if (h < 120) { r1 = x; g1 = c; b1 = 0; }
    else if (h < 180) { r1 = 0; g1 = c; b1 = x; }
    else if (h < 240) { r1 = 0; g1 = x; b1 = c; }
    else if (h < 300) { r1 = x; g1 = 0; b1 = c; }
    else              { r1 = c; g1 = 0; b1 = x; }
    return [
        Math.round((r1 + m) * 255),
        Math.round((g1 + m) * 255),
        Math.round((b1 + m) * 255)
    ];
}

function drawRandomStroke(C, x, y) {
    // Draw a single brush stamp at the specified coordinate (very short path segment ~ single stamp)
    var doc = app.activeDocument;

    var p1 = new PathPointInfo();
    p1.kind = PointKind.CORNERPOINT;
    p1.anchor = [x, y];
    p1.leftDirection = [x, y];
    p1.rightDirection = [x, y];

    var p2 = new PathPointInfo();
    p2.kind = PointKind.CORNERPOINT;
    p2.anchor = [x + 1, y];
    p2.leftDirection = [x + 1, y];
    p2.rightDirection = [x + 1, y];

    var sp = new SubPathInfo();
    sp.closed = false;
    sp.operation = ShapeOperation.SHAPEXOR;
    sp.entireSubPath = [p1, p2];

    var tp = doc.pathItems.add("__tmp__", [sp]);
    try { tp.strokePath(ToolType.BRUSH); } catch (e) {}
    try { tp.remove(); } catch (e) {}
}

// Draw one stroke at the given scale + rotation without modifying the brush preset (preserves sampled tip bitmap).
//
// Principle: CC 2019 strokePath renders at the brush preset's Dmtr; writing Dmtr corrupts sampled tips.
// Instead, draw a stroke at the current brush's actual size onto a temp layer, then apply
// geometric transforms (scale + rotate), and finally merge down.
// Result: tip bitmap is preserved, output shape = strokePath actual output x ratio, rotated by rotateDeg.
//
// Interface deliberately does not accept "native pixels" -- takes ratio directly to avoid depending on origDmtr.
//
// Parameters:
//   C              - run config (only passed through to drawRandomStroke)
//   x, y           - target center coordinates (pixels)
//   ratio          - scale factor (1.0 = original; 0.5 = half; 2.0 = double)
//   rotateDeg      - clockwise rotation degrees (0 = no rotation)
//   allowUpscale   - when ratio > 1, allow upscaling (introduces slight interpolation blur)
function drawStrokeTransformed(C, x, y, ratio, rotateDeg, allowUpscale) {
    if (!allowUpscale && ratio > 1.0) ratio = 1.0;
    if (ratio < 0.01) ratio = 0.01;                 // Defensive: extreme small values
    var rot = (rotateDeg || 0) % 360;
    if (rot < 0) rot += 360;

    var needScale  = (Math.abs(ratio - 1.0) >= 0.01);
    var needRotate = (rot >= 0.5 && rot <= 359.5);  // Too close to 0 / 360 is considered no rotation

    if (!needScale && !needRotate) {                // No transform needed: draw directly, no overhead
        drawRandomStroke(C, x, y);
        return;
    }

    var doc = app.activeDocument;
    var savedLayer = doc.activeLayer;
    var tmpLayer = null;
    try {
        tmpLayer = doc.artLayers.add();
        tmpLayer.name = "__stroke_tmp__";
        doc.activeLayer = tmpLayer;

        drawRandomStroke(C, x, y);

        // Check whether the layer actually has content (stroke may land outside canvas -> bounds = 0)
        var hasContent = false;
        try {
            var b = tmpLayer.bounds;
            if (b && b.length === 4) {
                var bw = b[2].as("px") - b[0].as("px");
                var bh = b[3].as("px") - b[1].as("px");
                hasContent = (bw > 0 && bh > 0);
            }
        } catch (eB) {}

        if (hasContent) {
            // Use layer content bounding-box center as anchor.
            // For symmetric tips, content center ~= (x, y), so visual center is stable after scale/rotate.
            if (needScale) {
                var pct = ratio * 100;
                tmpLayer.resize(pct, pct, AnchorPosition.MIDDLECENTER);
            }
            if (needRotate) {
                tmpLayer.rotate(rot, AnchorPosition.MIDDLECENTER);
            }
            tmpLayer.merge();   // merge to layer below; after merge, activeLayer = savedLayer
            tmpLayer = null;
        } else {
            tmpLayer.remove();
            tmpLayer = null;
            doc.activeLayer = savedLayer;
        }
    } catch (e) {
        if (tmpLayer) { try { tmpLayer.remove(); } catch (eR) {} }
        try { doc.activeLayer = savedLayer; } catch (eS) {}
        // swallow exception to avoid interrupting batch; single stroke failure is non-fatal
    }
}

// Draw one stroke in a large temp doc (avoids main canvas clipping), scale to targetMaxPx by actual bounds,
// optionally rotate, then duplicate the layer to (x, y) on the main canvas and merge.
//
// This is the core drawing function shared by Tab 1 (cell-short-side mode) and Tab 2 (fitToCell).
// The main canvas is often much smaller than the brush output (e.g. 256 cell + 5000px brush);
// drawing directly on the main canvas gets clipped and bounds measurement is inaccurate.
// Using a sufficiently large temp doc captures the full stroke.
//
// Parameters:
//   C              - run config
//   x, y           - target center coordinates on main canvas
//   targetMaxPx    - long-side pixel size after scaling
//   tmpDocSize     - temp doc edge length (>= actual stroke output; recommend = actualPx * 1.2)
//   rotateDeg      - clockwise rotation degrees (0 = no rotation)
//   allowUpscale   - when actual stroke < target, allow upscaling; false = clamp to original size
function drawStrokeFitTo(C, x, y, targetMaxPx, tmpDocSize, rotateDeg, allowUpscale) {
    var mainDoc = app.activeDocument;
    var tmpDoc = null;
    try {
        // Create transparent large doc at same resolution as main canvas (avoids DPI conversion on duplicate)
        tmpDoc = app.documents.add(tmpDocSize, tmpDocSize, mainDoc.resolution, "_fit_tmp",
                                   NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        // Note: app.documents.add comes with one transparent background layer; draw directly onto it
        setForegroundColor(C);
        drawRandomStroke(C, tmpDocSize / 2, tmpDocSize / 2);

        var bw = 0, bh = 0;
        try {
            var b = tmpDoc.activeLayer.bounds;
            if (b && b.length === 4) {
                bw = b[2].as("px") - b[0].as("px");
                bh = b[3].as("px") - b[1].as("px");
            }
        } catch (eB) {}

        if (bw > 0 && bh > 0) {
            var bigSide = Math.max(bw, bh);
            var ratio = targetMaxPx / bigSide;
            if (!allowUpscale && ratio > 1.0) ratio = 1.0;
            if (ratio < 0.01) ratio = 0.01;
            if (Math.abs(ratio - 1.0) >= 0.01) {
                tmpDoc.activeLayer.resize(ratio * 100, ratio * 100, AnchorPosition.MIDDLECENTER);
            }

            // Optional rotation (around content bounding-box center; for symmetric tips visual center is stable)
            var rot = (rotateDeg || 0) % 360;
            if (rot < 0) rot += 360;
            if (rot >= 0.5 && rot <= 359.5) {
                tmpDoc.activeLayer.rotate(rot, AnchorPosition.MIDDLECENTER);
            }

            // Key: translate the layer in tmpDoc to the (x, y) position in mainDoc's coordinate space
            // BEFORE duplicating. The duplicated layer content then sits at (x, y) on the main canvas.
            // (Translating after duplicate risks the content landing outside the main canvas bounds.)
            var nb = tmpDoc.activeLayer.bounds;
            var cx = (nb[0].as("px") + nb[2].as("px")) / 2;
            var cy = (nb[1].as("px") + nb[3].as("px")) / 2;
            tmpDoc.activeLayer.translate(new UnitValue(x - cx, "px"), new UnitValue(y - cy, "px"));

            // Duplicate to main canvas and merge
            tmpDoc.activeLayer.duplicate(mainDoc, ElementPlacement.PLACEATBEGINNING);
            app.activeDocument = mainDoc;
            mainDoc.activeLayer.merge();
        }

        // Close temp document
        app.activeDocument = tmpDoc;
        tmpDoc.close(SaveOptions.DONOTSAVECHANGES);
        tmpDoc = null;
        app.activeDocument = mainDoc;
    } catch (e) {
        if (tmpDoc) {
            try { app.activeDocument = tmpDoc; tmpDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        }
        try { app.activeDocument = mainDoc; } catch (e3) {}
        // swallow single-stroke failure; batch continues
    }
}

// Probe actual brush output size (true long-side pixels of a single strokePath output).
// Draws one stroke in an 8192x8192 transparent temp doc and reads bounds.
// Returns the longest side in pixels; returns 0 on failure.
function probeBrushOutputSize(C) {
    var mainDoc = null;
    try { mainDoc = app.activeDocument; } catch (e) {}
    var probeDoc = null;
    var probeSize = 8192;
    try {
        probeDoc = app.documents.add(probeSize, probeSize, 72, "_probe",
                                     NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
        setForegroundColor(C);
        drawRandomStroke(C, probeSize / 2, probeSize / 2);
        var bw = 0, bh = 0;
        try {
            var b = probeDoc.activeLayer.bounds;
            if (b && b.length === 4) {
                bw = b[2].as("px") - b[0].as("px");
                bh = b[3].as("px") - b[1].as("px");
            }
        } catch (eB) {}
        probeDoc.close(SaveOptions.DONOTSAVECHANGES);
        probeDoc = null;
        if (mainDoc) try { app.activeDocument = mainDoc; } catch (e3) {}
        return Math.max(bw, bh);
    } catch (e) {
        if (probeDoc) try { probeDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
        if (mainDoc) try { app.activeDocument = mainDoc; } catch (e3) {}
        return 0;
    }
}

function savePNG(doc, path) {
    var opts = new PNGSaveOptions();
    opts.compression = 6;
    opts.interlaced = false;
    doc.saveAs(new File(path), opts, true, Extension.LOWERCASE);
}

// =====================================================================
// Config persistence (hand-written JSON, compatible with old ExtendScript)
// =====================================================================
function saveConfig(cfg) {
    try {
        var f = CONFIG_FILE;
        f.encoding = "UTF-8";
        f.open("w");
        f.write(toJSON(cfg));
        f.close();
    } catch (e) {}
}

function loadConfig() {
    try {
        if (!CONFIG_FILE.exists) return null;
        CONFIG_FILE.encoding = "UTF-8";
        CONFIG_FILE.open("r");
        var text = CONFIG_FILE.read();
        CONFIG_FILE.close();
        if (!text) return null;
        var obj = eval("(" + text + ")");
        // Legacy compat: split gridSize "AxB" into gridCols / gridRows
        if (obj.gridSize && (obj.gridCols === undefined || obj.gridRows === undefined)) {
            var m = String(obj.gridSize).match(/^(\d+)\s*x\s*(\d+)$/i);
            if (m) { obj.gridCols = parseInt(m[1]); obj.gridRows = parseInt(m[2]); }
        }
        // Merge defaults to fill any missing fields from older configs
        for (var k in DEFAULTS) {
            if (obj[k] === undefined) obj[k] = DEFAULTS[k];
        }
        return obj;
    } catch (e) { return null; }
}

function toJSON(obj) {
    if (obj === null || obj === undefined) return "null";
    var t = typeof obj;
    if (t === "string") return '"' + obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "") + '"';
    if (t === "number" || t === "boolean") return String(obj);
    if (obj instanceof Array) {
        var parts = [];
        for (var i = 0; i < obj.length; i++) parts.push(toJSON(obj[i]));
        return "[" + parts.join(",") + "]";
    }
    if (t === "object") {
        var parts2 = [];
        for (var k in obj) {
            if (obj.hasOwnProperty(k)) parts2.push(toJSON(k) + ":" + toJSON(obj[k]));
        }
        return "{" + parts2.join(",") + "}";
    }
    return "null";
}

// =====================================================================
// General utilities
// =====================================================================
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

// Fisher-Yates shuffle (in-place)
function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

// Build a cell draw mask (true=draw / false=skip).
// mode: "quota" = exact count then shuffle; "stratified" = balanced per row.
function buildCellDrawMask(cols, rows, probability, mode) {
    var total = cols * rows;
    var lit = Math.round(total * probability / 100);
    if (lit < 0) lit = 0;
    if (lit > total) lit = total;
    var mask = [];
    for (var i = 0; i < total; i++) mask.push(false);
    if (mode === "stratified" && rows > 1) {
        var base = Math.floor(lit / rows);
        var remainder = lit - base * rows;
        // Which rows get one extra lit cell: generate [1,1,...,0,0,...] then shuffle
        var extras = [];
        for (var r = 0; r < rows; r++) extras.push(r < remainder ? 1 : 0);
        shuffleArr(extras);
        for (var r2 = 0; r2 < rows; r2++) {
            var rowLit = base + extras[r2];
            var idx = [];
            for (var c = 0; c < cols; c++) idx.push(r2 * cols + c);
            shuffleArr(idx);
            for (var k = 0; k < rowLit; k++) mask[idx[k]] = true;
        }
        return mask;
    }
    // Default / "quota": exact total count + shuffle
    var indices = [];
    for (var i2 = 0; i2 < total; i2++) indices.push(i2);
    shuffleArr(indices);
    for (var k2 = 0; k2 < lit; k2++) mask[indices[k2]] = true;
    return mask;
}
function padZero(num, len) { var s = String(num); while (s.length < len) s = "0" + s; return s; }
function sanitize(s) { return String(s).replace(/[\\\/:*?"<>|\s]/g, "_").replace(/_+/g, "_"); }
function countObj(o) { var n = 0; for (var k in o) if (o.hasOwnProperty(k)) n++; return n; }
function cloneObj(o) {
    if (o === null || typeof o !== "object") return o;
    if (o instanceof Array) {
        var arr = [];
        for (var i = 0; i < o.length; i++) arr.push(cloneObj(o[i]));
        return arr;
    }
    var out = {};
    for (var k in o) if (o.hasOwnProperty(k)) out[k] = cloneObj(o[k]);
    return out;
}

function parseBrushNames(text) {
    var lines = String(text || "").split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        var s = lines[i].replace(/^\s+|\s+$/g, "");
        if (s) out.push(s);
    }
    return out;
}

function rgbToHex(rgb) {
    function h(n) { var s = n.toString(16); return s.length < 2 ? "0" + s : s; }
    return "#" + h(rgb[0]) + h(rgb[1]) + h(rgb[2]);
}

function hexToRgb(hex) {
    if (!hex) return null;
    hex = String(hex).replace(/^\s+|\s+$/g, "").replace(/^#/, "");
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
    return [
        parseInt(hex.substr(0, 2), 16),
        parseInt(hex.substr(2, 2), 16),
        parseInt(hex.substr(4, 2), 16)
    ];
}

// Color swatch widget: preview swatch + hex input + color picker button, returns { getRgb, setRgb }
function makeColorSwatch(parent, initialRgb) {
    var grp = parent.add("group");
    grp.spacing = 4;
    grp.alignChildren = "center";

    var current = (initialRgb || [255, 255, 255]).slice();

    var sw = grp.add("panel");
    sw.preferredSize = [26, 20];
    sw.helpTip = "Current color (click the button on the right to open color picker)";

    function paint() {
        try {
            sw.graphics.backgroundColor = sw.graphics.newBrush(
                sw.graphics.BrushType.SOLID_COLOR,
                [current[0] / 255, current[1] / 255, current[2] / 255, 1]
            );
        } catch (e) {}
    }
    paint();

    var hexIn = grp.add("edittext", undefined, rgbToHex(current));
    hexIn.characters = 8;
    hexIn.onChange = function () {
        var rgb = hexToRgb(hexIn.text);
        if (rgb) { current = rgb; paint(); }
        else hexIn.text = rgbToHex(current);
    };

    var pickBtn = grp.add("button", undefined, "...");
    pickBtn.preferredSize = [26, 22];
    pickBtn.helpTip = "Open color picker";
    pickBtn.onClick = function () {
        var picked = pickColor(current);
        if (picked) {
            current = picked;
            hexIn.text = rgbToHex(current);
            paint();
        }
    };

    return {
        group: grp,
        getRgb: function () { return current.slice(); },
        setRgb: function (rgb) {
            if (!rgb) return;
            current = rgb.slice();
            hexIn.text = rgbToHex(current);
            paint();
        }
    };
}

// Pop the system color picker (prefer ExtendScript global; fall back to PS color picker)
function pickColor(initRgb) {
    var rgb = initRgb || [255, 255, 255];
    try {
        var initInt = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
        var picked = $.colorPicker(initInt);
        if (picked >= 0) return [(picked >> 16) & 0xFF, (picked >> 8) & 0xFF, picked & 0xFF];
        return null;
    } catch (e) {}
    // fallback: temporarily borrow PS foreground color + showColorPicker
    try {
        var oldFG = app.foregroundColor;
        var tmp = new SolidColor();
        tmp.rgb.red = rgb[0]; tmp.rgb.green = rgb[1]; tmp.rgb.blue = rgb[2];
        app.foregroundColor = tmp;
        var ok = app.showColorPicker();
        var out = null;
        if (ok) {
            var fg = app.foregroundColor;
            out = [Math.round(fg.rgb.red), Math.round(fg.rgb.green), Math.round(fg.rgb.blue)];
        }
        app.foregroundColor = oldFG;
        return out;
    } catch (e2) {}
    return null;
}

function paletteToText(palette) {
    var lines = [];
    for (var i = 0; i < palette.length; i++) lines.push(rgbToHex(palette[i]));
    return lines.join("\n");
}
