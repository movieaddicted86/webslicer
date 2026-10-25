# Features in detail

The short list is in the [README](../README.md); this page keeps the full description. Which
PrusaSlicer feature exists here and which does not is in
[Feature-Comparison.md](Feature-Comparison.md); what is still planned is in [TODO.md](../TODO.md).

## Window

- **Rail on the far left**: _Slicing_ (the plater and the preview), _Library_, _Printers_; at the
  bottom _Preferences_ and _About_. The current place is filled with the accent colour; on a narrow
  window the names drop away and on a phone the rail becomes a bottom tab bar.
- **48 px top bar**: the **Menu** (import models and presets, and the **Export** submenu with project
  3MF, current settings, presets bundle, G-code and the two "save to library" actions), undo and redo,
  a **hide the side panels** switch that gives the 3D view the full width (remembered per browser), the
  project name with its save state, the **Prepare | Preview** switch centred in the bar and, at the
  right edge, the update notice. Every function has one home: the rail opens the dialogs, the preset
  rows' cogs open the settings views, and the menu keeps only import and export.
- **Floating cards over the scene**: the 3D view fills everything right of the rail below the bar, and
  the object list and the context panel are cards that float over it – so folding a card or hiding the
  panels never moves or resizes the canvas.
- **Preferences**: a small dialog behind the rail's _Preferences_ – the Simple / Advanced / Expert
  mode (how many settings the print, filament and printer views show), the read-only status of the
  online services (whether `WEBSLICER_UPDATE_CHECK` is on, when the last check ran, the environment
  variable that switches it) and **Reset panel layout**, which puts the stored widths, folded cards
  and hidden panels back to their defaults.
- **Printers**: one dialog behind the rail's _Printers_ and the printer dropdown's _Add / remove
  printers…_, with four tabs – **My printers** (the PrusaLink / OctoPrint / Moonraker hosts), **Vendor
  profiles** (install and update the vendor bundles), **Filaments** (the visible-filament filter) and
  **Custom printer** (the two-step wizard). The entry point picks the tab: the rail opens on _My
  printers_, the printer dropdown on _Vendor profiles_.
- **Object list card** at the scene's top left: the **Object list** card holds the thumbnail tiles with
  the name, the size/instances line and the row's markers, and its empty state offers the **open the
  library** link and the **Add objects…** button beside the drop hint. In the Preview it shows the
  **Sliced info** card – with the green **SLICED** badge in its heading – and the **Legend** card, whose
  heading carries the colour-scheme drop-down. Each inner card folds on its own and the whole card
  folds to its header row, which keeps the object count; a chevron in the header toggles that, and the
  width (276 px by default, 220–420 px) can be dragged on its right edge. Both are remembered per
  browser. Below 1280 px the card starts folded; on a phone it is a drawer that the top bar opens.
- **Context panel** at the scene's top right, with the destination/Slice footer as its own card: it
  shows what the current state is about. With nothing selected it is the plate – a **Printer &
  material** card (printer tile, name, nozzle and bed summary, the loaded filament with its colour dot
  and nozzle) above the **Print settings** card: the print preset select with its cog in the heading,
  the filament and printer rows, and the quick settings as grouped rows (Walls & perimeters, Infill,
  Supports & adhesion) with the label on the left and a 150 px control on the right, switches for the
  on/off ones. With one object selected the header carries a thumbnail tile, the name, the "1 instance ·
  size" line and the ✎ rename, the preset and quick-setting rows stay, and the object's own cards
  follow: **Transform** (X/Y/Z column headers in the axis colours, Position / Rotation / Size / Scale
  rows with the unit inside the field, the instances stepper with **Fill bed**, one row of 34 px icon
  buttons for mirror X/Y/Z, reset rotation/scale/all, the proportions lock, split to objects/parts and
  add instance – each with its tooltip – and the bounding box and object info), **Settings** (extruder
  and **Per-object settings** as a row with an **Edit…** button and the count of overrides), **Parts**
  (the add menu, the rows with the volume-type icon, the name and a delete action, the rename on a
  double-click, and the manipulation of the picked volume) and **Layer ranges**. The footer keeps the
  **Destination** choice and the **Slice** button in view while the cards scroll. In the Preview the
  column shows the **View**, **G-code check** and **Layer** cards over a footer with **Send to
  printer**, the export icon and the destination. While a tool is open the column is the tool's panel:
  its title and ✕, its controls, the primary action pinned at the bottom and the key hints below them.
  Simple mode shows the plate content only; a multi-selection is explained instead of the object cards.

### Where do I find…

| I want to…                                           | Go to                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Slice, arrange, edit objects                         | Rail **Slicing** (the plater); the preview is **Preview** in the top bar's switch          |
| Open a model from the file library                   | Rail **Library**                                                                           |
| Import models from my computer                       | **Menu → Import models…** (Ctrl+I / Ctrl+O)                                                |
| Import presets from a bundle or a G-code file        | **Menu → Import presets…**                                                                 |
| Load, add, test or remove a print host               | Rail **Printers → My printers**                                                            |
| Install or update vendor profiles                    | Rail **Printers → Vendor profiles**, or **Add / remove printers…** in the printer dropdown |
| Choose which system filaments the selector shows     | Rail **Printers → Filaments**                                                              |
| Create a printer with its filament                   | Rail **Printers → Custom printer**                                                         |
| Change the Simple / Advanced / Expert mode           | Rail **Preferences → Mode**                                                                |
| See whether the update check is on, and reset panels | Rail **Preferences → Online services / Interface**                                         |
| Edit the print, filament or printer settings         | The cog next to the preset in its row (plater or settings view)                            |
| Edit an object's position, parts, overrides, ranges  | Select its row in the object list – the context panel on the right shows them              |
| Open a tool (move, paint, cut, layer height)         | The **tool strip** at the top of the 3D view – its controls then take the context panel    |
| Choose the print host the G-code goes to             | The **Destination** select in the context panel's footer (or ask in the send dialog)       |
| Export the project, settings, presets or G-code      | **Menu → Export ▸**                                                                        |
| Save the project or the G-code to the library        | **Menu → Export ▸ Save … to library…**                                                     |
| Undo or redo                                         | The top bar's ↶ / ↷ (or Ctrl+Z / Ctrl+Shift+Z)                                             |
| Give the 3D view the full width                      | The top bar's **hide panels** button                                                       |
| See the version, the licence and the update notice   | Rail **About**                                                                             |

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
- **Tool strip** floating over the top of the scene, centred between the two cards: one button per
  registry tool (move, rotate, scale, place on face, arrange and its settings, cut, paint
  supports/seam/extruder, variable layer height) plus delete and add/remove instance. The open tool's
  controls fill the context panel, and the panel ends with the tool's key hints (mouse icons and key
  chips). A band too narrow for the strip moves its trailing groups into a **⋯** menu; below 900 px the
  strip scrolls sideways instead. Names appear next to the icons while the whole strip fits with them;
  a disabled tool's tooltip says why it is disabled.

## Settings and profiles

- **All slicing options** of the installed PrusaSlicer version: the option schema is generated at
  runtime from `prusa-slicer --help-fff/--help-sla` and sorted into the familiar
  _Print / Filament / Printer Settings_ tabs with pages and groups (Simple / Advanced / Expert mode,
  search, modified markers, reset).
- **Vendor profiles**: all PrusaSlicer vendor bundles (Prusa, Creality, Anycubic, … 35 vendors) including
  inheritance, compatibility conditions (`compatible_printers_condition`), printer/nozzle variants,
  default filaments. User presets are stored as PrusaSlicer-compatible `.ini` files.
- **User presets**: save the current settings as a preset, **rename** it (inheriting presets, linked
  physical printers, server projects and autosaves follow the new name) or delete it; system presets
  stay read-only.
- **Presets between installations** – _Export presets_ writes all user presets and physical printers
  as one PrusaSlicer-compatible bundle (no host addresses, no access keys). **Import presets** reads
  such a bundle, or the `prusaslicer_config` block of a G-code file, shows what it found and asks per
  name clash whether to keep, overwrite or keep both. Settings that are unsafe to import – process
  commands, output paths, unknown keys – are dropped and listed with the reason.
- **Configuration limits** while editing (see [safety.md](safety.md)): a blocked value disables
  **Slice** with its reason.
- **Printer setup wizard** (**Add / remove printers…** in the printer dropdown opens the Printers dialog
  on _Vendor profiles_; the rail's **Printers** opens the same dialog on _My printers_): vendor profiles
  to install, a **Filaments** step and a **Custom printer** in two steps. The filament step
  lists the system filaments of the installed vendors grouped by vendor and material – filter by text,
  tick with _All_ / _None_ / _Only this type_ per group, and **Apply** stores the choice, so the
  filament selector only offers those presets from then on (user presets, the defaults and the active
  filament always stay). Nothing ticked means "show all", and the **Show all filaments** checkbox under
  the preset rows lifts the filter for a session. A custom printer asks for bed size, height, nozzle and
  firmware, then for its filament (name, first-layer/other-layer hotend and bed temperatures, diameter;
  215/215 °C, 60/60 °C and 1.75 mm by default). Saving stores the printer preset and a user filament
  preset `<printer> – <filament>`, and selects both. Values face the same configuration limits as the
  settings editor: a blocked value turns red, disables **Save** and is refused by the server as well.
- **Multi-extruder / MMU**: filament preset per extruder, wipe tower settings, extruder count in the
  printer preset.

## Slicing and preview

- **Slicing** with the real engine (FFF and SLA), progress via server-sent events, job queue with
  parallel jobs.
- **G-code preview**: toolpaths coloured by feature type (PrusaSlicer colours) or as colour print, layer
  slider (top/bottom) with a value badge, travel moves, legend with lengths, print time / filament usage
  / cost, and the colour schemes (height, width, speed, fan speed, temperature, volumetric flow, layer
  time). The **Sliced info** card (file, filament in m/g/cm³, time, layers, size – and the **SLICED**
  badge in its heading) and the **Legend** card (swatches with their amounts, the scheme drop-down in
  its heading) sit in the floating object list card at the scene's top left; the context panel on the
  right carries the **View** card (colour scheme, a "Show" section with a legend swatch and a switch per
  layer – travel, retractions, seams, tool changes, shells), the **G-code check** (preflight) and the
  **Layer** card (range summary, the two layer sliders with their badges, the layer codes and the move
  slider). The footer card holds **Send to printer** (primary), the export icon and the destination.
- **Colour change, pause and custom G-code at a layer**: add them at the top slider position like the
  "+" on PrusaSlicer's vertical slider (M600 / pause with message / any G-code), markers on the slider,
  automatic re-slice, stored in the 3MF project.
- **Thumbnails in G-code**: the browser renders previews in the sizes and formats of the printer profile
  (PNG, JPG, QOI for Prusa displays), the server embeds them into the G-code. Printer displays and
  Mainsail/Fluidd/OctoPrint then show the print with an image.

## Export, printers and files

- **Export**: G-code (also binary `.bgcode`), project as 3MF (with all settings, opens directly in
  desktop PrusaSlicer), config bundle `.ini`.
- **Physical printers** (**Printers → My printers**): upload (optionally starting the print) to
  **PrusaLink**, **OctoPrint** and **Klipper/Moonraker** (Mainsail/Fluidd), also over HTTPS with
  self-signed certificates. A host can
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
