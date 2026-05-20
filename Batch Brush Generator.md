# Batch Brush Generator

A Photoshop ExtendScript tool that batch-generates brush stroke preview sheets for every selected brush preset. Each output is a stitched grid PNG where every cell contains one or more strokes drawn by the corresponding brush.

---

## Installation

1. Copy `Batch Brush Generator.jsx` to:
   ```
   <Photoshop install folder>/Presets/Scripts/
   ```
2. Restart Photoshop (or use **File › Scripts › Browse…** without restarting).

## Running

**File › Scripts › Batch Brush Generator**

Requires Photoshop CC 2019 or later.

---

## Interface Overview

### Brush List

| Control | Description |
|---|---|
| **Group** dropdown | Filter the list to a saved custom group, or show all brushes |
| **+ New Group** | Save currently checked brushes as a named group |
| **Rename / Delete Group** | Manage custom groups |
| **Filter** text box | Real-time keyword filter (case-insensitive) |
| **Refresh** | Re-read all brush presets from Photoshop |
| **All (visible) / None (visible) / Invert (visible)** | Selection helpers scoped to the filtered view |
| **Clear All** | Uncheck every brush across all groups |

Check one or more brushes in the list; one output image is generated per checked brush.

---

### Canvas Size

| Field | Description |
|---|---|
| **Cell W / Cell H (px)** | Pixel dimensions of each grid cell |
| **BG** | Background fill color |
| **Transparent** | Output PNG with alpha channel (transparent background) |

---

### Output Folder

Choose a destination folder. Click **Browse…** to open a folder picker or **Open** to reveal the current folder in Explorer.

---

## Tab 1 — Multi-Stroke Grid

Fills each grid cell with multiple randomly distributed strokes.

### Parameters

| Control | Description |
|---|---|
| **Grid** dropdown | Preset grid layout (fills the col × row inputs) |
| **Cols × Rows** inputs | Final grid dimensions used for generation |
| **Strokes/cell** | Number of strokes drawn per cell |
| **Stroke size (% cell short-side)** Min – Max | Stroke long-side as a percentage of the cell's short side. The script probes actual brush output size, draws in a large temp document, scales to the target %, then composites into the cell — independent of the PS toolbar brush size |
| **Visual Test** | Opens a diagnostic document with 4 rows × 4 strokes comparing four ActionManager size-setting paths |

### Color Mode

| Mode | Description |
|---|---|
| **Palette (multi-color random)** | Picks randomly from the custom palette |
| **Fully random** | Random RGB each stroke |
| **Solid (main color)** | Every stroke uses the main color |
| **Analogous (main color +/− HSL)** | Slight hue/saturation/lightness variation around the main color |
| **Monochrome (same hue, varied lightness)** | Same hue and saturation, wide lightness range |

**Main color** — used by Solid, Analogous, and Monochrome modes.  
**Edit Palette…** — opens a sub-dialog to enter custom hex colors (one per line, `#RRGGBB`).

### Distribution

| Control | Description |
|---|---|
| **X Jitter** | Random horizontal offset per stroke slot (% of slot width) |
| **Y Jitter** | Random vertical offset (% of canvas height) |
| **Fixed Coords** | All cells share one random coordinate template |
| **Fixed Size** | All cells share one random size template |
| **Random Rotate** | Each stroke rotates 0–360° via temp-layer transform (tip texture preserved) |
| **Allow Upscale** | When target size exceeds actual brush output, allow upscaling (may introduce slight blur) |
| **Draw Probability** | Per-stroke draw chance (100 % = always; lower values create sparse / twinkle effects) |

---

## Tab 2 — Single Stroke

Places exactly one stroke, centered, in each grid cell.

### Parameters

| Control | Description |
|---|---|
| **Grid** | Independent col × row setting for Tab 2 |
| **Color mode / Main color / Edit Palette…** | Same as Tab 1 |
| **Draw Probability** | Per-cell draw decision |
| **Distribution** | How cells are selected when probability < 100 %: **Independent** (each cell rolls separately), **Quota Shuffle** (exact count distributed randomly), **Stratified** (evenly spread across rows) |
| **Fit to Cell** | Scale each stroke to the specified % of cell short-side based on measured bounds. Recommended — ignores PS toolbar brush size. Disables Fit to Native when on |
| **Target % of cell short-side** | Fill ratio used by Fit to Cell |
| **Fit to Native Size** | Legacy path: clamp stroke diameter to the brush's native preset Dmtr to avoid stretching sampled tips. Suitable for hard-round or vector brushes |

---

## Bottom Buttons

| Button | Description |
|---|---|
| **Reset Defaults** | Restore all controls to factory defaults |
| **Close** | Dismiss the dialog without generating |

---

## Output

Files are saved as PNG in the chosen output folder, named:

```
<BrushName>_<cols>x<rows>.png
```

After completion, a summary dialog shows the count of generated images, elapsed time, any brushes that were not found, and any brushes whose native size could not be read. You can click **Open output folder** to reveal the results directly.

---

## Technical Notes

- **Sampled-tip brushes**: The script never writes `Brsh.Dmtr` directly during stroke generation, which would corrupt the sampled bitmap and degrade the tip to a soft round. Size and rotation are applied via temporary-layer geometry transforms instead.
- **Brush size probing**: Before drawing, the script paints one stroke in an oversized transparent document and measures the actual bounding box. This `probeBrushOutputSize` value drives the temp-document size and scale ratios, making output dimensions stable regardless of the PS toolbar brush size.
- **Config persistence**: Settings are saved automatically to `%AppData%/BatchBrushGenerator_config.json` and restored on next launch.

---

## Compatibility

- **Photoshop CC 2019** and later (ExtendScript / ScriptUI)
- Windows and macOS

---

## License

MIT — free to use, modify, and distribute.
