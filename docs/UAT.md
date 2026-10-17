# WebSlicer – User Acceptance Test (UAT)

Version: 1.0.0-rc.2 · Engine: PrusaSlicer 2.9.6 · Date: 2026-10-17

Goal: confirm that WebSlicer covers the everyday workflow of a PrusaSlicer user in the browser.
Each test case has steps and an expected result. Please note deviations with test case number,
browser and screenshot.

## Preparation

1. Start with Docker: `docker compose up -d` → http://&lt;host&gt;:8080 (or Proxmox LXC, see README).
2. On first start the folder **Library → samples** contains a set of test models:
   `calibration_cube_20mm.stl`, `bridge_table.stl` (overhang), `cylinder_with_cube.stl`, `stepped_pyramid.stl`.
3. Browser: current Chrome, Edge, Firefox or Safari; WebGL must be enabled.
4. Test printer: a printer on the network (PrusaLink, OctoPrint or Klipper/Moonraker) for UAT-15.

## Test cases

| No | Area | Steps | Expected |
|---|---|---|---|
| UAT-01 | First start | Open the page | The "Printers" dialog appears, vendors and models are listed (thumbnails visible). |
| UAT-02 | Add printer | Prusa Research → Original Prusa MK4S → tick HF0.4 → Apply | Printer is selected; print and filament profile are set to the Prusa defaults automatically (0.20mm SPEED, Prusament PLA). The bed shows the MK4S bed model with texture. |
| UAT-03 | Custom printer | Printers → Custom printer → bed 220×220, nozzle 0.4 → Create | New printer appears under "User presets", the bed in the viewer is 220×220. |
| UAT-04 | Load model | Library → samples → `calibration_cube_20mm.stl` → Open | Cube sits centred on the bed, the object list shows it, upload status "uploaded". Alternatively drag & drop a file onto the 3D view. |
| UAT-05 | Manipulation | Select object; enter rotation X = 45°; key F, click a face; scale 150 %; arrange (A) | After rotation the object does not sink below the bed; after "place on face" the face lies flat; bounding box shows 30 mm; object stays on the bed. Ctrl+Z undoes every step. |
| UAT-06 | Slice and preview | Slice now | Progress bar, then a preview with coloured toolpaths, working layer slider, statistics with time, filament, layers. |
| UAT-07 | Settings | Print Settings → Infill → fill density 40 %; mode Expert → more options; search field "seam"; mode Simple in the plater | Preset shows "(modified)", orange dot on the tab; Expert shows more options than Simple; search finds "Seam position"; in the plater Simple hides the object list with modifiers/painting/height ranges (like PrusaSlicer), Advanced/Expert show it. |
| UAT-08 | Save preset | 💾 next to the print profile → name "UAT Test" → Save; switch preset and back; 🗑 delete | Preset appears under "User presets", values are kept, deleting falls back to the printer's default profile. |
| UAT-09 | Supports/painting | Load `bridge_table.stl`; supports = "For support enforcers only"; slice → no supports; key L, paint the underside of the plate, Done; slice | Second slice contains green support material only below the painted area. "Clear all" removes the paint. |
| UAT-10 | Modifier | Load cube; "+" in the object row → Modifier → box; modifier settings → fill density 100 %; slice | Modifier visible as a yellow box; filament usage rises compared to UAT-06; blockers/negative volumes can be added the same way. |
| UAT-11 | Height ranges | `stepped_pyramid.stl`; "+ Range" 0–6 mm, layer h. 0.1; slice | Slab in the viewer; layer count rises, the first layers are 0.1 mm high (preview slider shows Z 0.1, 0.2, …). |
| UAT-12 | Project | Export → Save project to library → name; delete all; Library → open the project | Objects, positions, modifiers/paint and settings are restored; presets show no unwanted "(modified)". |
| UAT-13 | Autosave | Load an object, wait 10 s, reload the browser tab | Notice "Unsaved session found" → Restore brings the plater back. |
| UAT-14 | G-code export | Preview → Export G-code | File downloads; the header contains `; thumbnail` blocks (PNG/QOI); shown with a preview image in the PrusaSlicer G-code viewer or on the printer. |
| UAT-19 | Colour change / pause | Slice the cube; move the top slider to the middle → "＋ Color"; move it higher → "⏸ Pause"; export G-code | Markers appear on the slider, the preview switches to "Color print" with two colours, G-code is re-sliced automatically and contains `M600` and `M601` with the message right before the chosen layers; saved projects keep both. |
| UAT-15 | Printer upload | Printers → Add printer (type, IP, API key) → Test connection; preview → Send to printer | "Connected" on test; the file appears on the printer (PrusaLink: USB list, Klipper: file list, OctoPrint: Files); optionally the print starts. |
| UAT-16 | 3MF from PrusaSlicer | Import a 3MF project from desktop PrusaSlicer (with modifier and paint) | Objects, volumes, paint and profiles are taken over; slicing result matches the desktop (time/filament within a few %). |
| UAT-17 | Multi-user | Open a second browser/device in parallel and slice | Both jobs run (MAX_JOBS), objects do not mix; autosave is separate per browser. |
| UAT-18 | Proxmox | Run `proxmox/webslicer-lxc.sh` on the PVE host | LXC is created, service runs, URL is printed; `systemctl status webslicer` is active. |

## Known limitations (rc.2)

- No cut tool, no text embossing, no continuous layer-height profile (height ranges only).
- Painting works per triangle (the mesh is subdivided for this); smart fill / bucket fill are missing.
- Thumbnails are embedded in ASCII G-code only, not in `.bgcode`.
- The printer upload was implemented against the API documentation and is not yet verified with real
  hardware (which makes UAT-15 especially important).
- The user interface is English only.

## Acceptance criterion

UAT-01 to UAT-14 without blockers; UAT-15 successful with at least one printer type.
