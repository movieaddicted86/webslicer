# Features in detail

![WebSlicer: load a model, slice, preview, send to the printer in 13 seconds](images/hero.gif)

The short list is in the [README](../README.md); this page keeps the full description. Which
PrusaSlicer feature exists here and which does not is in
[Feature-Comparison.md](Feature-Comparison.md); what is still planned is in [TODO.md](../TODO.md).

## Window

- **Rail on the far left**: _Slicing_ (the plater and the preview), _Library_, _Printers_; at the
  bottom _Preferences_ and _About_. The current place is filled with the accent colour; on a narrow
  window the names drop away and on a phone the rail becomes a bottom tab bar.
- **48 px top bar**: the **Menu** (import models and presets, then two flyouts – **Settings** with print,
  filament and printer settings, and **Export** with project 3MF, current settings, presets bundle,
  G-code and the two "save to library" actions), undo and redo, a **hide the side panels** switch that
  gives the 3D view the full width (remembered per browser), the project name with its save state, the
  **Prepare | Preview** switch centred in the bar and, at the right edge, the update notice. Every
  function has one home: the rail opens the dialogs, the menu keeps import and the two flyouts, and the
  preset rows' own settings buttons carry the stated exception – the three settings views open from
  **Menu → Settings** and from their row, both rendered from the one navigation table.
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
  printers_, the printer dropdown on _Vendor profiles_. Vendor profiles opens with one line – all up
  to date, or how many vendors have an update – and lists only the vendors with an update and the
  user's own ones; **Show all vendors** reveals the rest. A row names the installed version and, only
  when it is really newer and stable, the offered one.
- **Object list card** at the scene's top left: the **Object list** card holds the thumbnail tiles with
  the name, the size/instances line and the row's markers, and its empty state offers the **open the
  library** link and the **Add objects…** button beside the drop hint. A click on a row selects it;
  **Ctrl/Cmd click** toggles a row in and out of the selection, a **Shift click** selects the range from
  the row the last click landed on, **Ctrl+A** selects every object and **Esc** (or a click on the empty
  bed) clears. The row selection and the 3D view's are the same selection, so clicking a mesh in the
  scene picks the same row. With several objects selected the context panel shows "N objects selected"
  with the group actions – **Merge**, **Duplicate**, **Hide/Show**, **Arrange selection** and
  **Delete** – and the cards of a single object's transform stay away. In the Preview it shows the
  **Sliced info** card – with the green **SLICED** badge in its heading – and the **Legend** card, whose
  heading carries the colour-scheme drop-down. Each inner card folds on its own and the whole card
  folds to its header row, which keeps the object count; a chevron in the header toggles that, and the
  width (276 px by default, 220–420 px) can be dragged on its right edge. Both are remembered per
  browser. Below 1280 px the card starts folded; on a phone it is a drawer that the top bar opens.
- **Context panel** at the scene's top right, with the destination/Slice footer as its own card: it
  shows what the current state is about. With nothing selected it is the plate – a **Printer &
  material** card (printer tile, name, nozzle and bed summary, the loaded filament with its colour dot
  and nozzle) above the **Print settings** card: the print preset select with its settings button in
  the heading, the filament and printer rows, and the quick settings as grouped rows (Walls &
  perimeters, Infill, Supports & adhesion) with the label on the left and a 150 px control on the
  right, switches for the on/off ones. Below the last group an **All settings…** link opens the full
  print settings view: the list stays short and every other option is one click away. With one object selected the header carries a thumbnail tile, the name, the "1 instance ·
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
  Simple mode shows the plate content only; with several objects selected it shows the count and the
  group actions (merge, duplicate, hide/show, arrange selection, delete) instead of the object cards.

### Where do I find…

| I want to…                                           | Go to                                                                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Slice, arrange, edit objects                         | Rail **Slicing** (the plater); the preview is **Preview** in the top bar's switch                              |
| Open a model from the file library                   | Rail **Library**                                                                                               |
| Import models from my computer                       | **Menu → Import models…** (Ctrl+I / Ctrl+O)                                                                    |
| Import presets from a bundle or a G-code file        | **Menu → Import presets…**                                                                                     |
| Load, add, test or remove a print host               | Rail **Printers → My printers**                                                                                |
| Install or update vendor profiles                    | Rail **Printers → Vendor profiles**, or **Add / remove printers…** in the printer dropdown                     |
| Choose which system filaments the selector shows     | Rail **Printers → Filaments**                                                                                  |
| Create a printer with its filament                   | Rail **Printers → Custom printer**                                                                             |
| Change the Simple / Advanced / Expert mode           | Rail **Preferences → Mode**                                                                                    |
| See whether the update check is on, and reset panels | Rail **Preferences → Online services / Interface**                                                             |
| Edit the print, filament or printer settings         | **Menu → Settings ▸**, the button next to the preset in its row, or **All settings…** below the quick settings |
| Edit an object's position, parts, overrides, ranges  | Select its row in the object list – the context panel on the right shows them                                  |
| Open a tool (move, paint, cut, layer height)         | The **tool strip** at the top of the 3D view – its controls then take the context panel                        |
| Choose the print host the G-code goes to             | The **Destination** select in the context panel's footer (or ask in the send dialog)                           |
| Export the project, settings, presets or G-code      | **Menu → Export ▸**                                                                                            |
| Save the project or the G-code to the library        | **Menu → Export ▸ Save … to library…**                                                                         |
| Undo or redo                                         | The top bar's ↶ / ↷ (or Ctrl+Z / Ctrl+Shift+Z)                                                                 |
| Give the 3D view the full width                      | The top bar's **hide panels** button                                                                           |
| See the version, the licence and the update notice   | Rail **About**                                                                                                 |

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
  With **keep both** the two halves are placed apart right after the cut, using the arrange settings
  (spacing, rotations, alignment) and moving only the halves – other objects stay where they are, so
  the plate check passes and **Slice now** is enabled without pressing Arrange. If the halves do not
  fit side by side, they keep the source's placement, the plate overlap check names the reason and a
  toast says to arrange them. Cut and placement are one undo step.
- **Tool strip** floating over the top of the scene, centred between the two cards: one button per
  registry tool (move, rotate, scale, place on face, arrange and its settings, cut, paint
  supports/seam/extruder, variable layer height) plus delete and add/remove instance. The open tool's
  controls fill the context panel, and the panel ends with the tool's key hints (mouse icons and key
  chips). A band too narrow for the strip moves its trailing groups into a **⋯** menu; below 900 px the
  strip scrolls sideways instead. Names appear next to the icons while the whole strip fits with them;
  a disabled tool's tooltip says why it is disabled.
- **Leaving a tool**: the ✕ in its panel, **Esc**, its own strip button, or a **click on the empty
  scene**. The ✕ sits in the same place in every panel – the head's top right – is a 28 × 28 px
  button with the tooltip "Close (Esc)" and a visible focus ring, so it is meant to be found rather
  than guessed. The empty click runs the same close as Esc, so the cut plane, the brush cursor and the layer
  chart disappear with the tool, and it clears the selection, so the context panel returns to the plate
  panel with the presets, the destination and the **Slice** button. A click on an object keeps the tool
  open; an orbit or pan drag is not a click and leaves it open as well. Move, rotate and scale are gizmo
  modes, not tool panels – they never take the context panel, so the Slice footer always stays in reach.
  A tool whose object or selection goes away (delete, merge, undo, project load) closes by itself.

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
- **Plate and setting checks on every path into a slice** (T-034, S1-e, T-073, T-078): an object off
  the bed, a skirt or brim past the print area, overlapping toolpaths, a blocked setting – the reason
  is listed and **Slice** is disabled. The checks measure each object's real convex hull on the bed,
  not its bounding box, so a turned or diagonal part and two interlocking parts pass where the boxes
  would collide (see [safety.md](safety.md)). The same guard runs in the store action, so the
  **Preview** button, the re-slice after a colour change and a scripted caller are refused too, and the
  Preview lists the same reasons (a setting issue opens its field). A finished result for a plate that
  no longer passes stays readable but cannot be exported, saved or sent. The server refuses the same
  plates with a 400.
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
- **An outdated result says so**: a finished result stays on screen when the plate or the settings stop
  passing the checks, but it is drawn **greyed out** – one grey at low opacity instead of the layer
  colours – and the Preview opens with "This result is outdated – the plate does not pass the checks"
  above the list of reasons. Fixing the plate brings the colours back without a new slice; a plain
  change of settings or objects (plate still fine) keeps the colours and the "Slice again to update"
  note.
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
  G-code dropped there, without uploading through the browser. A click opens a file as before; the
  checkbox (on hover, or while a selection exists) and a **Ctrl/Cmd click** add single files to a
  selection and a **Shift click** takes the whole range from the row the last click landed on. The bar
  above the list then offers **Load all** (every selected file in one go, arranged on the plate as a
  single load is), **Delete selected** (one confirmation that names the count – deleting is permanent)
  and **Clear**; the arrow keys walk the rows, **Space** toggles and **Enter** opens. A folder is never
  part of a multiple selection.
- **Autosave**: the plater is saved automatically as a project and offered for restore after a reload
  or browser crash; **session restore** survives closing the browser.
- Multi-user capable on the LAN, no client installation, also works on tablets.
