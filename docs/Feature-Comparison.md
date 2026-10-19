# Feature comparison PrusaSlicer 2.9 ↔ WebSlicer

As of 2026-10-17 (WebSlicer 1.0.0-rc.2, engine PrusaSlicer 2.9.6)

Legend: ✅ available · 🟡 partial · ❌ missing · ➖ not sensible on the web / not planned
Priority: **P1** needed for version 1.0 · **P2** important afterwards · **P3** convenience · **P4** later or never

## 1. Files and projects

| PrusaSlicer feature | WebSlicer | Prio | Note |
|---|---|---|---|
| Import STL / OBJ / 3MF / AMF | ✅ | – | drag & drop, import button, library |
| Import STEP | ❌ | P2 | the CLI can read STEP (`--export-stl`), the server can convert |
| Import SVG (emboss) | ❌ | P3 | together with text embossing |
| Save / load project (3MF with all data) | ✅ | – | library + autosave; PrusaSlicer projects are read |
| Recent projects | 🟡 | P3 | library shows dates; no "recent" list |
| Import config from G-code / 3MF / INI | 🟡 | P2 | 3MF yes; G-code header and INI bundle missing |
| Export config / config bundle | 🟡 | P2 | INI export available; bundle export of all presets missing |
| Export plate as STL/OBJ (incl. supports) | ❌ | P3 | CLI `--export-stl` can do it |
| Export G-code / send to printer | ✅ | – | |
| Export toolpaths as OBJ | ❌ | P4 | |
| Binary G-code (.bgcode) | 🟡 | P2 | generating yes; ASCII↔binary conversion and thumbnails in bgcode missing |
| G-code viewer (load an external G-code file) | ❌ | P2 | parser exists, only loading from file/library is missing |
| Printables / URL protocol | ➖ | P4 | |

## 2. Plater and objects

| Feature | WebSlicer | Prio | Note |
|---|---|---|---|
| Object list with volumes, settings, ranges | ✅ | – | tree object → volume; ranges in the panel |
| Instances (set number, fill bed, instance list) | ✅ | – | shared mesh/volumes/paint, own transform; `+`/`-` keys, `×n` badge, "Fill bed"; saved in the 3MF |
| Move / rotate / scale (gizmo + numbers) | ✅ | – | |
| Mirror (X/Y/Z) | ✅ | – | buttons in the panel; mirrors the picked instance, else the whole selection, about the world axis through the instance position |
| World/local coordinates in the gizmo | 🟡 | P3 | world only |
| Place on face | ✅ | – | |
| Arrange (with settings: spacing, rotation, alignment) | 🟡 | P2 | simple shelf packing without settings; "arrange selection" missing |
| Selection: rectangle, all, invert | 🟡 | P3 | click / Ctrl+click / Ctrl+A; rectangle missing |
| Undo / redo with history | 🟡 | P3 | undo/redo yes; history list missing |
| Copy / paste | ❌ | P3 | duplicate available |
| Rename, object info (size, volume, triangles, errors) | 🟡 | P2 | triangles yes; volume, manifold check, rename missing |
| Reload from disk / replace with STL | ❌ | P3 | can be solved via the library |
| Split to objects / split to parts | ❌ | **P1** | separate connected shells |
| Merge (combine objects) | ❌ | P2 | |
| Unit conversion (inch / metre) | ❌ | P3 | scale ×25.4 as helper |
| Simplify model (triangle reduction) | ❌ | P3 | three.js SimplifyModifier |
| Repair (Netfabb / Microsoft) | ➖ | P4 | Windows desktop only |
| Extruder per object / volume | ✅ | – | |
| Per-object settings | ✅ | – | |
| Modifiers (box/cylinder/sphere/slab/mesh) | ✅ | – | |
| Shape gallery (bundled shapes) | ❌ | P3 | put `resources/shapes` back into the image |
| Support enforcers / blockers (volumes) | ✅ | – | |
| Negative volumes | ✅ | – | |
| Height ranges (layer range modifiers) | ✅ | – | |
| Variable layer height (profile, smoothing, adaptive) | 🟡 | P2 | ranges only; continuous profile missing |
| Cut (cut plane, connectors) | ❌ | P2 | |
| Measure tool | ❌ | P3 | |
| Text embossing | ❌ | P3 | |
| SVG embossing | ❌ | P3 | |
| Paint-on supports | ✅ | – | sphere brush; smart fill / bucket fill missing (P3) |
| Seam painting | ✅ | – | |
| MMU painting | ✅ | – | |
| Brush options (height range, ignore back faces, fill angle) | ❌ | P3 | |
| Bed shape editor, vendor bed with texture | ✅ | – | |
| Multiple beds (2.9) | ❌ | P3 | |
| Sequential printing: gantry visualization | ❌ | P4 | setting available |
| Visibility (hide/show object) | ✅ | – | checkbox = printable |

## 3. Presets and settings

| Feature | WebSlicer | Prio | Note |
|---|---|---|---|
| System presets of all vendors, compatibility, alias | ✅ | – | |
| Save / delete user presets | ✅ | – | |
| Rename preset | ❌ | P2 | |
| Detach from system preset | ❌ | P3 | |
| Unsaved-changes dialog (transfer / save / discard) | 🟡 | **P1** | discard confirmation only; transferring the changes to the new preset is missing |
| Compare presets | ❌ | P3 | |
| Mode Simple / Advanced / Expert | ✅ | – | settings tabs and plater |
| Search in settings (Ctrl+F) | 🟡 | P3 | search field per tab; global search missing |
| Tooltips with description and option name | ✅ | – | |
| Per-extruder settings (printer tab, extruder count) | ✅ | – | |
| Filament overrides | ✅ | – | |
| Dependencies / compatible printers | ✅ | – | as text; multi-select dialog missing (P4) |
| Configuration wizard | 🟡 | P2 | printer dialog + custom printer; filament selection per vendor and temperature step missing |
| Online profile updates (refresh vendor bundles) | ❌ | P2 | bundles from the AppImage; updating from the PrusaSlicer-settings repo would be possible server-side |
| Configuration snapshots | ❌ | P4 | data lives as files in the volume |
| Physical printers linked to presets | 🟡 | P3 | field exists, not evaluated |
| Preferences (units, camera, behaviour) | 🟡 | P3 | only mode and display options |
| Language (German etc.) | ❌ | P2 | UI is English |
| Keyboard shortcut overview | 🟡 | P3 | in the About dialog, incomplete |

## 4. Slicing and preview

| Feature | WebSlicer | Prio | Note |
|---|---|---|---|
| Slicing (FFF) with the full engine, progress | ✅ | – | |
| Slicing (SLA) | 🟡 | P3 | `.sl1` export works; no preview, no support point editor |
| Preview by feature type, legend, layer slider | ✅ | – | |
| Preview colour schemes: height, width, speed, fan, temperature, volumetric flow, layer time, extruder, colour print | ✅ | **P1** | all views incl. layer time linear/logarithmic; layer times are feedrate based, scaled to the slicer's time estimate |
| Horizontal slider (moves within a layer) | ❌ | P2 | |
| View options: travel, retractions, seams, wipe, tool changes, colour changes, shells, tool marker | 🟡 | P2 | travel only |
| Legend with time/length per feature | 🟡 | P2 | length yes; time per feature missing |
| Colour change / pause / custom G-code at a layer (M600 via slider) | ✅ | – | buttons at the top slider position, markers on the slider, colour print view; stored as `Prusa_Slicer_custom_gcode_per_print_z.xml` |
| Sliced info (time, filament, cost, layers) | ✅ | – | stealth time missing (P3) |
| G-code text window at the current position | ❌ | P3 | |
| Wipe tower visualization and purging volumes dialog | 🟡 | P3 | wipe tower is sliced; dialog missing |
| Thumbnails in G-code | ✅ | – | |
| Slicer warnings (validation, hints) | 🟡 | P2 | errors yes; warnings/hints are not shown |

## 5. Printers and print hosts

| Feature | WebSlicer | Prio | Note |
|---|---|---|---|
| PrusaLink, OctoPrint, Klipper/Moonraker | ✅ | – | hardware test pending |
| Prusa Connect, Duet, Repetier, FlashAir, AstroBox, MKS, Obico | ❌ | P3 | |
| Upload queue / printer status | ❌ | P2 | |
| Firmware flasher | ➖ | P4 | |

## 6. User interface and operations

| Feature | WebSlicer | Prio | Note |
|---|---|---|---|
| Camera: perspective/ortho, views (iso, top, front …), zoom to selection | 🟡 | P2 | reset view only |
| Collapse sidebar | ❌ | P3 | |
| Notifications / hints | 🟡 | P3 | toasts |
| Multi-user, library on NAS, autosave | ✅ | – | WebSlicer specifics |
| Docker / Proxmox installation | ✅ | – | |

## Summary

Covered are the complete slicing core, profiles, per-object settings, volumes, painting, height
ranges, library and print hosts. The largest remaining gaps are in the **preview** (view options
such as shells, sequential slider, tool marker) and in **object tools** (instances, mirror, split, cut,
measure, emboss) as well as the **unsaved-changes transfer** and **STEP import**.
