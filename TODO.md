# WebSlicer – To-do / Roadmap

Based on [docs/Feature-Comparison.md](docs/Feature-Comparison.md) (PrusaSlicer 2.9 ↔ WebSlicer).
Priority by frequency of use in everyday printing and PrusaSlicer parity.

## P1 – required for version 1.0 (in this order)
1. [x] **Colour change / pause / custom G-code at a layer** via the preview slider (M600, colour print preview)
2. [x] **Preview colour schemes**: height, width, speed, fan speed, temperature, volumetric flow, layer time
       (linear/logarithmic), tool; gradient legend with value range
3. [ ] **Instances**: set number, fill bed, instances in the object list (shared geometry, own transform)
4. [ ] **Mirror** X/Y/Z in the manipulation panel
5. [ ] **Split to objects / parts** (separate connected shells)
6. [ ] **Unsaved-changes dialog** on preset switch: transfer / save / discard

## P2 – important afterwards
- [ ] Preview: horizontal slider, view options (retractions, seams, wipe, tool/colour changes, shells), time per feature, slicer warnings
- [ ] STEP import through the CLI (`--export-stl`)
- [ ] Merge objects; object info (volume, manifold check), rename
- [ ] Arrange with settings (spacing, rotation) and "arrange selection"
- [ ] Cut tool (cut plane; connectors later)
- [ ] Continuous layer-height profile (smoothing, adaptive)
- [ ] Rename preset; config bundle import/export; import config from G-code
- [ ] Update vendor profiles online (PrusaSlicer-settings)
- [ ] Extend the configuration wizard (filaments per vendor, temperatures)
- [ ] Camera: views (iso/top/front/…), orthographic, zoom to selection
- [ ] Printer status / upload queue (needs hardware test)
- [ ] Localized UI (German, …)
- [ ] G-code viewer for files from the library; bgcode conversion and thumbnails in bgcode

## P3 – convenience
- [ ] Measure tool, text/SVG embossing, shape gallery (put resources/shapes back into the image)
- [ ] Brush options (smart fill, bucket fill, height range), world/local gizmo, rectangle selection, copy/paste
- [ ] Compare presets, detach from system, global search, undo history, preferences
- [ ] Simplify model, unit conversion, reload from disk, recent projects
- [ ] Multiple beds, purging volumes dialog, stealth time, G-code text window, collapsible sidebar
- [ ] More print hosts (Prusa Connect, Duet, Repetier, Obico), physical printers linked to presets
- [ ] SLA: support point editor, hollowing editor, SLA preview
- [ ] Docker image stage 2: own PrusaSlicer build without GUI (≈ 300–400 MB)
- [ ] Library: thumbnails, search, sorting

## P4 – later or not planned
- Netfabb/Microsoft repair, firmware flasher, Printables integration, toolpaths as OBJ, gantry visualization, configuration snapshots

## Done
- [x] Slicing core, profiles, settings tabs (modes), quick settings, preview by feature type, thumbnails
- [x] Volumes (modifiers, support enforcers/blockers, negative, parts), height ranges, support/seam/MMU painting
- [x] Place on face, undo/redo, vendor bed, library, autosave, project save/load
- [x] Print hosts PrusaLink/OctoPrint/Moonraker with TLS option, Docker, Proxmox, UAT 1.0.0-rc.2

## Needs you (Robert)
- [x] Upload to a real printer – Klipper/Moonraker tested 2026-10-19 (PrusaLink / OctoPrint untested, on hold:
      no hardware available)
- [x] Proxmox helper on a real PVE host – tested 2026-10-19
- [x] Re-test the reworked Proxmox helper (Default and Advanced settings) – tested 2026-10-19
- [x] Approve the MCP integration per docs/MCP-Concept.md – approved 2026-10-19
