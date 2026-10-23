# Features in detail

The short list is in the [README](../README.md); this page keeps the full description. Which
PrusaSlicer feature exists here and which does not is in
[Feature-Comparison.md](Feature-Comparison.md); what is still planned is in [TODO.md](../TODO.md).

## Plater

- **3D plater** (Three.js): import STL / OBJ / 3MF / AMF / STEP (drag & drop; STEP is converted on the
  server), multiple objects, move / rotate / scale (gizmo + numeric input), **place on face** (key F),
  arrange, duplicate, build-volume check, extruder assignment, **per-object settings** (overrides like
  in PrusaSlicer).
- **Support, seam and MMU painting**: paint enforcers and blockers or the extruder directly onto the
  model (keys L / P, adjustable brush radius, undo), stored like PrusaSlicer as per-triangle attributes
  in the 3MF.
- **Undo/redo** in the plater, **vendor bed** with the model and texture of the selected printer.
- **Volumes** like in PrusaSlicer: **modifiers** (regions with their own settings, e.g. 100 % infill),
  **support enforcers / blockers**, **negative volumes** (cut-outs) and additional **parts** as box,
  cylinder, sphere, slab or from a mesh file; stored in the 3MF and restored on import.
- **Height ranges**: Z ranges of an object with their own layer height and any other setting
  (variable layer height), like the height range modifiers in PrusaSlicer.
- **Instances**: set the number, fill the bed, an instance list with its own transform – the geometry,
  volumes and paint are shared.
- **Split to objects / parts**, **merge objects**, **object info** (volume, manifold check) and
  **rename**.
- **Cut tool**: cut plane with height and tilt, keep upper/lower/both parts, via the PrusaSlicer CLI.
- **Left tool bar** with one panel per tool (move, rotate, scale, place on face, cut, paint supports/
  seam/extruder, layer height); short labels appear when the 3D view is wide enough.

## Settings and profiles

- **All slicing options** of the installed PrusaSlicer version: the option schema is generated at
  runtime from `prusa-slicer --help-fff/--help-sla` and sorted into the familiar
  _Print / Filament / Printer Settings_ tabs with pages and groups (Simple / Advanced / Expert mode,
  search, modified markers, reset).
- **Vendor profiles**: all PrusaSlicer vendor bundles (Prusa, Creality, Anycubic, … 35 vendors) including
  inheritance, compatibility conditions (`compatible_printers_condition`), printer/nozzle variants,
  default filaments. User presets are stored as PrusaSlicer-compatible `.ini` files.
- **Configuration limits** while editing (see [safety.md](safety.md)): a blocked value disables
  **Slice** with its reason.
- **Multi-extruder / MMU**: filament preset per extruder, wipe tower settings, extruder count in the
  printer preset.

## Slicing and preview

- **Slicing** with the real engine (FFF and SLA), progress via server-sent events, job queue with
  parallel jobs.
- **G-code preview**: toolpaths coloured by feature type (PrusaSlicer colours) or as colour print, layer
  slider (top/bottom), travel moves, legend with lengths, print time / filament usage / cost, and the
  colour schemes (height, width, speed, fan speed, temperature, volumetric flow, layer time).
- **Colour change, pause and custom G-code at a layer**: add them at the top slider position like the
  "+" on PrusaSlicer's vertical slider (M600 / pause with message / any G-code), markers on the slider,
  automatic re-slice, stored in the 3MF project.
- **Thumbnails in G-code**: the browser renders previews in the sizes and formats of the printer profile
  (PNG, JPG, QOI for Prusa displays), the server embeds them into the G-code. Printer displays and
  Mainsail/Fluidd/OctoPrint then show the print with an image.

## Export, printers and files

- **Export**: G-code (also binary `.bgcode`), project as 3MF (with all settings, opens directly in
  desktop PrusaSlicer), config bundle `.ini`.
- **Physical printers**: upload (optionally starting the print) to **PrusaLink**, **OctoPrint** and
  **Klipper/Moonraker** (Mainsail/Fluidd), also over HTTPS with self-signed certificates. A host can
  be linked to a printer preset; sending G-code sliced for another printer is refused unless you
  override it with a reason (which is written to the audit log).
- **G-code preflight**: every finished job is scanned once for commands that should not be in a print
  file – EEPROM writes and resets, disabled endstops, changed steps/mm or currents, firmware updates,
  absurd temperatures and moves before the first homing. Blocking findings stop the upload unless it
  is overridden with a reason; the preview and the send dialog show them with their line.
- **File library**: a mounted directory (`/library`, e.g. a NAS share) with STL/OBJ/3MF/AMF/STEP,
  projects and G-code. Files can be browsed and opened in the browser, projects stored as 3MF and finished
  G-code dropped there, without uploading through the browser.
- **Autosave**: the plater is saved automatically as a project and offered for restore after a reload
  or browser crash; **session restore** survives closing the browser.
- Multi-user capable on the LAN, no client installation, also works on tablets.
