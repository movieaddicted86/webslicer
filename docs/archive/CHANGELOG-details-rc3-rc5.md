# Long-form changelog entries: rc.3 – rc.5 and Unreleased

These are the original, detailed entries that `CHANGELOG.md` carried until the pre-1.0 docs diet
(T-082). The changelog now states one to three lines per change; the reasoning, the measured numbers,
the exact rules and the reproduction details live here, so nothing was deleted. The entries are kept
verbatim, newest first, as they were written for 1.0.0-rc.3 to 1.0.0-rc.5 and for `Unreleased` at
that time.

Owners of the affected files and the relevant `docs/` pages carry the current behaviour; this file is
history and is not updated any more.

---

## Unreleased

- **The plate check measures each object's real outline (T-078, round a):** every rule – off the bed,
  brim, skirt, toolpath conflict and the sequential-printing clearance – read the axis-aligned bounding
  box, so a bar turned 45° near a corner, an arc such as a cable holder or two interlocking parts were
  refused although PrusaSlicer slices them (since T-073 that block was final). The outlines are now the
  **convex hull of each instance's XY projection** (`shared/src/plater/hull.ts`), built from the same
  vertices in the browser and on the server: overlap is the SAT penetration depth of the two polygons,
  the skirt is the hull of all objects grown by its distance, and the brim/skirt room is the measured
  distance to the bed border. A box gives exactly the verdicts it gave before, and a concave part is
  still treated as its hull – conservative, never looser than the slicer. The arrange (round b) is
  unchanged and follows in its own round. New: a `l_bracket.stl` sample, `e2e/specs/plate-gate.spec.ts`
  covers two interlocking L parts, `server/src/routes/http.test.ts` an L pair that overlaps by boxes
  only, and `docs/safety.md` / `docs/features.md` (UAT-53) explain the hull.

- **The rc.5 review's housekeeping (T-081, findings P-6 / P-7 / P-8 / P-10):** three rough edges
  from the release review. **MCP quotas:** a token may have two slicing jobs queued or running and may
  start 30 slices within a rolling hour (`MCP_MAX_CONCURRENT_JOBS`, `MCP_MAX_SLICES_PER_HOUR`); the
  refusal is an MCP tool error naming the limit, it is audited, and it applies per token – the
  browser's own slice never waits behind an agent's burst, while the global `MAX_JOBS` stays.
  **Error boundary:** a component that throws in the viewer, the preview panel or the dialogs now
  shows a small "Something went wrong – Reload view" card in that region with a retry button that
  remounts it, instead of a blank page; uncaught errors also reach the toast and the console through
  the root's error hooks. **Audit log rotation:** `data/audit.log` rotates at 10 MB and keeps five
  generations (`AUDIT_LOG_MAX_BYTES`, `AUDIT_LOG_KEEP_FILES`), and the UI reads a bounded tail with
  async fs instead of loading the whole file – the strict write of the send override still rotates
  and still fails the request when it cannot record. **Docs:** the line-end list in
  [docs/safety.md](docs/safety.md) shows `\n`, `\r` and `\r\n` instead of real line breaks,
  [SECURITY.md](SECURITY.md) names the current `1.0.x` line, and the G-code preflight header points
  at `plateCheck.ts` for the object bounds. New tests: `server/src/mcp/quotas.test.ts`,
  `server/src/services/audit.test.ts` and `e2e/specs/error-boundary.spec.ts`.

- **Cutting with "keep both" places the two halves apart (T-079):** the halves of a cut share the
  source's footprint, so the plate check blocked slicing until the user pressed Arrange (T-073 made
  that block visible again). After a successful cut with **Both parts** the app now arranges the two
  new objects itself with the plater's arrange settings – the clearance, the 90° rotations and the
  alignment from the Arrange gear – and moves nothing else: every other object and every other
  instance stays exactly where it was, and the halves stay selected. **Slice now** is enabled right
  away; on a bed too small for both halves they keep the source's placement, the plate overlap check
  names the reason and an info toast says to arrange them, so nothing fails silently. **Keep upper** /
  **keep lower** are unchanged, and the cut plus its placement stay **one undo step** (Ctrl+Z brings
  the uncut object back). No new setting, no API change; `cut.spec.ts` asserts disjoint footprints and
  slices without a manual arrange, `web/src/state/cut.test.ts` covers the placement, the untouched
  neighbour and the no-fit case, and `docs/features.md` / `docs/UAT.md` (UAT-35) describe it.
- **One selection that behaves the same in the object list, the scene and the Library (T-077, findings
  F-03b and F-03c):** a click in the object list selected one object with Shift behaving like Ctrl, so a
  range could not be picked at all, and the Library knew only one file at a time – loading or deleting
  five models meant five rounds of the same click. Both lists now run one shared rule
  (`web/src/selection.ts`, pure and unit tested): a plain click picks one row, **Ctrl/Cmd click**
  toggles a row in or out, a **Shift click** selects the range from the row the last click landed on
  (the anchor survives further Shift clicks, so a range extends), **Ctrl+A** selects all and **Esc**
  clears. The object list and the 3D view share that one selection, so clicking a mesh in the scene
  picks the same row, and the anchor lives in the store next to `selectedIds`. With several objects
  selected the context panel shows **"N objects selected"** with the group actions it can offer –
  **Merge** (only for single-instance objects, with the reason in the tooltip), **Duplicate**,
  **Hide/Show**, **Arrange selection** and **Delete** – instead of a note pointing elsewhere; no
  transform editing for a multi-selection. In the Library a plain click, the name and **Enter** still
  open a file, a folder still opens on a click, and the checkbox (quiet until the row is hovered or a
  selection exists) or a Ctrl click adds single files while Shift takes a range; folders are never
  selected with files. The new bar above the list offers **Load all** (the selected files are imported
  in one go – one undo step, arranged like a single load, then the dialog closes), **Delete selected**
  (one confirmation that names the count; the API has no bulk delete, so the files are deleted one by
  one and any failure is named back with the file still selected) and **Clear**. The arrow keys walk
  the rows, **Space** toggles and **Enter** opens. No new settings, no API change; new
  `web/src/selection.test.ts` and `e2e/specs/selection.spec.ts`, `docs/features.md`, a UAT case and the
  shortcut list unchanged (Ctrl+A and Esc were already documented).
- **The Vendor profiles tab is a short answer instead of a wall of versions (T-076, finding F-03a):**
  Robert's rc.5 test showed an endless list of every vendor with a version arrow, a source link and
  "up to date" on every row – and some arrows pointed _down_ (`1.1.0 → 0.1.0`,
  `Prusa Research SLA 1.0.7 → 1.0.0-alpha0`), because the list printed the newest version of each
  vendor's index whether or not it was newer, or a prerelease. The tab now opens with one summary
  line – "All vendor profiles are up to date", or "N vendors have updates" – the time of the last check
  and **Check for updates**. The list appears only when there is something to say and holds the vendors
  with an update plus the vendors the user has printers or a printer preset from; **Show all vendors**
  reveals the rest, and a long list scrolls inside the dialog body while the summary stays in view. A
  row reads _installed 2.4.14 · update 2.4.15_ with **Update** and never draws an arrow towards a lower
  or equal version; a remote prerelease is labelled "pre-release" behind **Show all vendors** and never
  counts as an update, and a newer bundle the engine cannot run names its reason. The source link moved
  from every row to one footer link to the profile repository, and rows wrap instead of clipping at
  ~1000 px. New `web/src/components/dialogs/printers/vendorUpdates.ts` (pure row/status rules, unit
  tested); no server or API change. `e2e/specs/vendor-update.spec.ts` covers the summary, the toggle,
  a lower version and a prerelease.

- **The documentation opens with an animation (T-083):** the README and [docs/features.md](docs/features.md)
  start with a 13-second recording of a real session – library, model, slice, G-code preview and the
  send dialog – instead of the still hero image. It is generated like the screenshots:
  `npm run docs:gif` replays the flow against the E2E image and the mock print host and writes
  `docs/images/hero.gif` (1280 × 720, ≤ 4 MB). No app code changed.

- **The settings side of the G-code preflight, a required hotend answer and an override that is really
  audited (T-080, review findings P-1, P-2 and P-3 of rc.5):** three print-safety gaps of the send
  gate are closed. **(P-1)** A binary `.bgcode` could not be read, so a forbidden `M500`, an `M211 S0`
  or a missing `G28` in a custom G-code block reached the printer behind the single
  `gcode.not_scanned` warning. The server now scans the **settings that produce the file** as well –
  the nine custom G-code keys of the merged config plus the plater's own blocks – with the same rules
  and the same code, stores the result as `info.preflight.config` and merges it into the send gate and
  the Preview (a finding names the setting and the line inside it, and is deduplicated against the
  file scan). Binary output keeps its "not read" warning but is no longer unprotected. **(P-2)** A
  printer host without a safety profile was only held to the global 450 °C ceiling; the printer setup
  now asks **"PTFE-lined or all-metal hotend?"** as a required choice (PTFE 240 °C, all-metal an
  explicit 450 °C), and a host that still has no profile warns with `send.no_limits` on every send
  until the question is answered – no silent migration. **(P-3)** The send gate's override is only
  acceptable because it is recorded, so its audit entry is written strictly: if `data/audit.log`
  cannot be written, the send is refused with 500 and nothing is uploaded. MCP call logging stays
  fail-soft. New: no settings; the hotend question replaces the "PTFE hotend (max 240 °C)" preset.

- **A tool panel's ✕ is meant to be found, and an outdated Preview says so (T-075, findings Z-03 and
  Z-06):** Robert could not find the close button of an open tool panel although it was there (Esc
  worked), and with a blocked plate the Preview kept showing the old sliced model as if it were
  valid. The ✕ is now a real button in the same place in every panel – the head's top right, 28 × 28
  px, the tooltip "Close (Esc)", keyboard focusable with a visible focus ring – so no tool has its
  own variant. When the plate checks or the configuration limits block a slice **and** a result is on
  screen, the Preview keeps that result but draws the toolpaths as one flat grey at low opacity (no
  feature or layer colours) and opens with the banner "This result is outdated – the plate does not
  pass the checks" above the list of reasons; fixing the plate brings the colours back without a new
  slice. A plain settings or object change with a valid plate keeps the colours and the existing
  "Slice again to update" note, and the T-073 gates (Slice, Export, Save, Send) are unchanged. No new
  settings.

## 1.0.0-rc.5 – 2026-10-25

- **Settings are where people look for them, and no two functions share the cog (T-074):** the full
  settings views were reachable only through the unlabelled cog next to a preset, and the same picture
  also stood for Preferences, a per-object override and a layer range. The **Menu** now has a
  **Settings** group with **Print settings…**, **Filament settings…** and **Printer settings…** – the
  words Robert looked for – and they are keyboard-reachable like every other menu item (ArrowRight
  opens the flyout, Enter picks an entry). The preset rows keep their own button, now labelled
  ("Edit print settings") and drawn with PrusaSlicer's sliders; that menu/row pair is the one stated
  exception to "one home per function" and the navigation map says so. The **quick settings** end with
  an **All settings…** text button that opens the print settings view, so the short list leads on to
  every option it leaves out. The **cog now means Preferences alone**: the object's **Settings** card
  and a volume's settings button carry Prusa's object-with-override-dot, a layer range's button the
  height-range icon, and the arrange options the wrench – each with a tooltip naming what it opens.
  Nothing new to configure: only entry points, labels and icons changed.

- **The plate and setting checks hold on every path into a slice, the Preview included (T-073):** the
  checks of T-034 and S1-e lived in the Prepare footer alone, so a plate whose skirt or brim ran over
  the bed edge disabled **Slice now** there – and switching to **Preview** sliced it anyway (a job came
  back whose skirt printed beside the bed). The check is now one guard the store action `slice` runs
  before it builds a request, so every trigger is covered: both **Slice** buttons, the automatic
  re-slice after a colour change or pause, a scripted call. The **Preview** shows the same reasons the
  footer lists (a setting issue still opens its field) and disables its own **Slice now** with the
  reason as tooltip; a result that is already on screen stays visible. A finished result whose plate
  no longer passes the checks cannot leave the app either – **Export G-code**, **Save to library** and
  **Send to printer** are disabled with the reason until the plate passes again. The server refuses
  the same plates on `POST /api/slice`, on the project slice and in the MCP `webslicer.slice` tool with
  a 400 and the reason, so neither the API nor an agent can skip the check. The rules moved to
  `shared/src/plater/plateCheck.ts`; the browser and the server both run that one copy. Warnings still
  slice.
- **Leaving a tool, and a context panel that never goes empty:** move, rotate and scale were stored as
  the open tool although they only drive the gizmo, so the context panel switched to tool mode with
  nothing to render – no presets, no printer, no **Slice**. They now only set the gizmo mode, their
  strip button still lights up, and the panel keeps the object's (or the plate's) content and the
  **Slice** footer. Only a tool with a panel becomes the open tool, and opening one closes the
  previous one with its cleanup. A **click on the empty scene** now leaves the open tool through the
  same path as **Esc** or the panel's ✕ – the cut plane, the brush cursor and the layer chart go with
  it – and clears the selection, so the plate panel and the **Slice** button come back; a click on an
  object keeps the tool open, and an orbit or pan drag is not a click. A tool whose object or
  selection goes away (delete, merge, undo, project load) closes by itself instead of leaving an empty
  column. The scene's view bar (**views**, **Persp/Ortho**, ⌖ and the ⌂ reset) is centred in the band
  between the two cards like the tool strip and the **Prepare | Preview** switch, wraps on a narrow
  window instead of running under a card, and keeps its ⌂ at the band's right edge.
- **The visual pass, part (b): the panel content and the preview mode (layout 3.0, T-070):** the
  context panel now reads like the mockup in all three modes. **Plate mode** keeps a **Printer &
  material** card (printer tile, name, nozzle and bed summary, the loaded filament with its colour dot
  and nozzle) above a **Print settings** card – the print preset select with its cog in the heading,
  the filament and printer rows – whose quick settings are grouped rows now: **Walls & perimeters**
  (perimeters), **Infill** (fill density, fill pattern) and **Supports & adhesion** (generate supports,
  brim as a switch), label left, 150 px control right. **Object mode** opens with a header card – the
  thumbnail tile, the object name, the "1 instance · size" line and the ✎ rename – and its **Transform**
  card carries X/Y/Z column headers in the axis colours, the Position / Rotation / Size / Scale rows
  with the unit inside each field, the instances stepper with **Fill bed**, and one row of 34 px icon
  buttons (mirror X/Y/Z, reset rotation/scale/all, the proportions lock, split to objects/parts, add
  instance) with a tooltip per button instead of the wall of text buttons; the proportions lock is now
  a control (locked, a typed scale moves all three axes). **Settings** is a row with **Edit…** and the
  override count, **Parts** lists the volumes with their type icon, the name and a delete action (the
  rename stays on a double-click). The **object list** rows are thumbnail tiles with the name and a
  size/instances line, and the empty list offers **Add objects…** beside the library link (the menu's
  file input, so the menu keeps its entry). **Preview mode**: the left cards are **Sliced info** (file,
  filament in m/g/cm³, time, cost, layers, size – with the green **SLICED** badge in the heading) and
  **Legend** (swatches with their amounts and the colour-scheme drop-down in the heading); the right
  panel is three cards – **View** (colour scheme, a "Show" section with a legend swatch and a switch
  per layer: travel, retractions, deretractions, seams, wipe, tool changes, colour changes, shells),
  **G-code check** (the preflight) and **Layer** (range summary, both layer sliders with value badges,
  the layer codes and the move slider) – over a footer card with **Send to printer** (primary), the
  export icon, save to library and the destination. Nothing the old preview panel held is gone (the
  report lists old control → new place); the sliders stay on the scene in the mockup's style.
- **The visual pass, part (a): floating cards, a 48 px bar and the mockup's tokens (layout 3.0, T-070):**
  the 3D view now fills everything right of the rail below the bar; the **object list** and the
  **context panel** are cards that float over it, with the destination/Slice footer as a card of its
  own at the scene's bottom right. Folding a card, dragging its width or hiding the panels no longer
  moves or resizes the canvas, and the scene's overlays (the tool strip, the view toolbar, the fit
  button, the key hints) keep to the band the cards leave free. The **top bar** is 48 px and one row –
  Menu, undo/redo, hide-panels, the project name with its save state, the **Prepare | Preview**
  segmented switch centred in it (it left the tool strip) and the update notice at its right edge
  (it left the rail). The **rail** draws an icon over an 11 px name with the current place filled with
  the accent colour. `styles.css` carries the mockup's token set (`--rail`, `--bar`, `--card`,
  `--card-2`, `--line`, `--field`, `--field-h`, `--text`, `--muted`, `--faint`, `--accent`,
  `--accent-h`, `--sel`, `--on-accent`, `--r`, `--h`) and the new `--bg`, `--edge` and `--shadow` –
  and the touched components read those names only; the older names stay as aliases for the rest. Controls are 32 px high, cards 10 px round with 12 px padding, icon buttons
  34 px. The object list card is 276 px wide by default (220–420 px draggable, 148 px folded to its
  header, which keeps the title, the object count and the fold chevron) and starts folded below
  1280 px. The tool strip's pill is centred in the band the two cards leave free and measured by a
  `ResizeObserver`, so a fold or a hidden panel gives it room at the same window width; its buttons
  are 34 px with 7 px dividers and the open tool in the accent. The panel content and the preview
  mode follow in part (b).
- **The tool strip and the tool panels (layout 3.0, L-4):** the tool bar left the scene's edge and is a
  floating pill at the top centre of the 3D view. It renders the registry in PrusaSlicer's groups –
  selection (delete), instance (+/−), transform (move, rotate, scale, place on face, arrange and its
  settings), paint (supports, seam, extruder), cut, layer height – so a tool still needs no button of
  its own, and it carries the object commands and the **Prepare | Preview** switch that used to be two
  tabs in the top bar. The open tool is the accent-coloured button; icons keep the "Name (Key)"
  tooltip, a disabled tool says why, and names appear next to the icons while the whole strip fits
  with them. A view too narrow for the pill moves its trailing groups into a **⋯** menu built from the
  same registry groups, and below 900 px the pill scrolls sideways instead of hiding anything. Tab
  walks the buttons in their visual order; `role="toolbar"` with a name and `aria-pressed` per tool,
  the switch is a `radiogroup`. An open tool no longer opens a box over the scene: its controls are
  the context panel's new **tool mode** (`contextMode` returns `tool` before every other mode) – the
  title and ✕, the tool's fields, the primary action pinned at the bottom and, from the registry, the
  tool's **key hints** (mouse icons, key chips, one line each). `ToolDock` is gone, the object toolbar
  keeps only merge, duplicate and delete-all (delete, +/− and arrange have their one home in the
  strip), and opening a tool never changes the selection. The About dialog and the shortcut table are
  still generated from the registry.
- **The context panel replaces the sidebar (layout 3.0, L-3):** the right column shows what the
  current state is about, derived by a pure selector (`web/src/state/contextMode.ts`, tool > preview >
  object > plate) instead of one fixed sidebar. With nothing selected it shows a **Printer** card
  (preset, bed, height, nozzle), the preset rows and the quick settings; with one object selected the
  same preset rows stay and four titled cards follow – **Transform** (position, rotation, scale, size,
  instances and **Fill bed**, bounding box, object info, mirror, splits, resets), **Settings**
  (extruder and the per-object overrides), **Parts** (the add menu, the volume rows with rename and the
  manipulation of the picked volume) and **Layer ranges**. The object rows in the left column are plain
  rows now (visibility, name, badges, instance count, info line, instance sub-list) – selecting one
  shows its controls in the panel. A sticky header carries the object name and instance count, and a
  sticky footer carries the new **Destination** choice (the print host for the send dialog, default
  "Ask when sending") and the unchanged Slice button with its progress, cancel, error and blocked-by-
  limits states. Simple mode keeps its reduced set (no object internals), other objects arriving with a
  multi-selection are explained instead, and the Preview keeps its own panel without the footer. Every
  control of the old sidebar and of the expanded object row is still reachable; `Sidebar.tsx` is gone.
- **One home per function (layout 3.0, L-3):** the navigation is now a single table
  (`web/src/nav/navMap.ts`) that the rail, the menu and the preset rows render, so a function cannot
  grow a second door. The rail holds Slicing, Library, Printers, Preferences and About; the menu keeps
  only **Import models…**, **Import presets…** and the **Export** submenu (project 3MF, current
  settings, presets bundle, G-code and the two "save to library" actions); the print, filament and
  printer settings open from the cog of each preset row; undo/redo and hide-panels live in the top bar
  only. The object toolbar lost its duplicate undo/redo and the quick settings lost their "All print
  settings…" link, and the top bar's view tabs are back to Plater/Preview.
- **The menu dropdown works like a menu:** one submenu at a time, opened by hover or click; leaving an
  item and its flyout closes the flyout after a short grace, another top-level item takes it over at
  once, and leaving the menu closes everything. A click keeps a flyout open, Escape closes the flyout
  first and the menu second (focus back on the trigger), ↑/↓ walk the items, →/← enter and leave a
  flyout, and a touch tap opens a flyout until another or an outside tap. The state machine is pure
  (`web/src/components/menu/menuState.ts`) and unit-tested; `e2e/specs/menu.spec.ts` drives the DOM.
- **Preferences is a real dialog:** the rail's **Preferences** opens the visibility mode
  (Simple/Advanced/Expert – the menu no longer carries it), the read-only online-services status
  (whether `WEBSLICER_UPDATE_CHECK` is on, when the last check ran, the variable itself) and **Reset
  panel layout**, which restores the stored column width, folded cards and hidden panels.
- **One Printers dialog:** the two dialogs called "printers" are now one dialog with four tabs –
  **My printers** (the print hosts, formerly "Physical printers"), **Vendor profiles**, **Filaments**
  and **Custom printer**. The rail opens it on My printers, the printer dropdown's _Add / remove
  printers…_ on Vendor profiles, and all "Physical printers" labels are gone. `e2e/specs/navigation.spec.ts`
  checks the rendered entries against the table and that no label appears in two regions; the
  documentation gained a "Where do I find…" table in `docs/features.md`.
- **The object list moved to the left column (layout 3.0, L-2):** the rows with their actions,
  instance and volume sub-lists and the manipulation fields now sit next to the 3D view, in a
  collapsible **Object list** card with the object count, and the right sidebar keeps the presets, the
  quick settings and the Slice panel. In the **Preview** the same column carries the **Sliced info**
  and **Legend** cards, so the right panel keeps the layer controls, the view options and the
  preflight. Every card folds on its own, the column folds to a 52 px strip that keeps the object
  count, and its width can be dragged between 220 and 420 px (300 px by default) – the card, the width
  and the column state are all remembered per browser. Below 1100 px the column starts folded; on a
  phone the top bar's new object button opens it as a drawer over the scene. Nothing moved out of
  reach: every row action, the per-object settings, the instance count and the selection behave as
  before.
- **New app shell with a rail and a slim top bar (layout 3.0, L-1):** the far-left rail holds the app's
  places – _Slicing_ (plater and preview), _Library_, _Printers_, and at the bottom _Preferences_ (the
  print/filament/printer settings) and _About_, which now carries the update notice. The current place
  is marked in the accent colour and with `aria-current`. The top bar is one row at every width: a
  **Menu** dropdown with every action the wide bar had (import models and presets, open from the
  library, save the project, the full Export list, the Simple/Advanced/Expert mode, printers, about),
  undo/redo, a **hide panels** switch that gives the 3D view the full width and is remembered per
  browser, the project name and the unchanged view tabs. The shell is one CSS grid
  (`rail | left | scene | sidebar`); the empty left track is ready for the object list of the next
  step. Below 1100 px the rail shows icons only, and below 640 px it becomes a bottom tab bar; nothing
  overflows at 360 px. New components: `AppShell`, `Rail`, `AppMenu`; the only new state is the
  `layout` slice's `panelsHidden`.
- **PrusaSlicer icons (I-1):** the tool bar, the top bar buttons (Import, Import presets, Library,
  Export, Printers), the object toolbar, the simple-mode object rows and the object list's row actions
  now use PrusaSlicer 3.0's artwork instead of the lucide glyphs – one icon per function, from one
  table (`web/src/icons/table.ts`) through one component (`<Icon name>`). The toolbar icons keep their
  size, hit areas, accessible names and "Name (Key)" tooltips. The SVGs are vendored from a pinned
  PrusaSlicer commit by `node scripts/vendor-icons.mjs` (recoloured to `currentColor`, no new runtime
  dependency), which also regenerates `docs/design/icon-sheet.html`; provenance is in
  `THIRD_PARTY_NOTICES.md`. See `docs/development.md` for adding an icon.
- **Stable test hooks (T-062, internal):** the app's structural elements carry `data-testid` hooks named
  by role (app shell, top bar, sidebar, object list, tool bar and its tools, tool panel, dialogs,
  preview controls, toasts), and the E2E suite selects them by those hooks instead of by class and
  position. Nothing visible changes – the hooks are the preparation for the layout rework, so moving
  an element no longer breaks the browser tests. A unit test (`e2e/hooks.test.ts`, part of `npm test`)
  fails when a spec reaches for a legacy structural class again.
- **Configuration wizard (T-061):** the Printers dialog is now the whole setup wizard. A new **Filaments**
  tab lists the system filaments of the installed vendors grouped by vendor and material, with a text
  filter, counts, and **All** / **None** / **Only this type** per group. **Apply** stores the ticks
  (`<DATA_DIR>/visible_filaments.json`, next to the installed printers) and the filament selector only
  offers those presets from then on – user presets, the defaults and the active filament always stay,
  an empty choice means "show all" (the previous behaviour), and a **Show all filaments** checkbox in
  the sidebar lifts the filter for a session. **Custom printer** became two steps: the existing form
  (name, bed, height, nozzle, firmware) is followed by its filament (name, first-layer/other-layer
  hotend and bed temperatures, diameter; 215/215 °C, 60/60 °C, 1.75 mm defaults). Saving creates the
  printer preset and a user filament preset `<printer> – <filament>` and selects both. Both steps run
  the shared configuration limits: a blocking value reddens the field, names the limit and disables
  **Save**, and a preset save now refuses such a value server-side with 400 and its issues (a soft-range
  value still only warns). Nothing new is exposed over MCP.
- **Vendor profile updates (T-060):** the printer bundle no longer ages with the image. The Printers
  dialog (Vendor profiles tab) lists every installed vendor with **installed → available**, checks the
  official PrusaSlicer-settings repository at most once a day, and installs a newer bundle with one
  click (per vendor or **Update all**) – nothing is installed without a click. Every bundle is
  validated before it replaces the installed one (same vendor, higher `config_version`, the same limit
  sweep and G-code preflight the bundled profiles go through); a bundle that trips a `block` finding
  is refused, the old one stays and the dialog lists the presets and rules that refused it. The
  installed file lives in `<DATA_DIR>/vendor/<Vendor>.ini`, the replaced one is kept as `.prev` for a
  one-step **Revert**; a user preset that inherits from a removed system profile is reported and left
  alone. `WEBSLICER_UPDATE_CHECK=off` (or `false`/`0`/`no`) makes no outbound request and the dialog
  offers **Install from file** instead, with the same validation. Sources are fixed
  (`raw.githubusercontent.com/prusa3d/PrusaSlicer-settings`, branch `master`); there is no signature
  to verify, the checks are the validation above.
- **Presets between installations (T-059):** a user preset can be **renamed** from the preset row; its
  file, every preset that inherits from it, physical printers bound to it, server projects and autosave
  3MFs follow the new name, and a clash or a mid-way failure leaves the store as it was. **Export
  presets** downloads all user presets and physical printers as one PrusaSlicer-compatible `.ini`
  bundle (print-host addresses and keys are never written). **Import presets** reads such a bundle or
  the `prusaslicer_config` block of a G-code file, previews the presets it holds, the keys it drops
  (process commands, output paths, unknown options, values with a lone carriage return) and the
  sections it cannot use, and asks one answer per name clash: keep the stored preset, overwrite it, or
  keep both under a free name. System presets are never overwritten. The G-code preview reads only the
  last 512 KiB of the upload and never executes the file.

## 1.0.0-rc.4 – 2026-10-24

- **Fixed (T-052 – remaining bugs from the 2026-10-23 review):**
  **B2 (printer switch):** `selectPreset('printer')` resized the filament slots but did not clamp
  the extruder indices, so a 5 → 1 switch left objects, volumes, MMU paint and the paint tool
  pointing past the count (the next `filament[i]` read was a `TypeError`, and the slice request
  carried extruder 5). It now clamps through the same helpers as `setExtruderCount`.
  **B7 (lost updates):** `addModelFromLibrary`, `arrange` and `touchProject` load, change and save a
  project across several `await`s, so concurrent REST/MCP calls dropped each other's objects. A
  per-project promise-chain lock (`withProjectLock`) spans load → modify → save in the services and
  in the route/MCP callers; 20 parallel adds now all land.
  **N5 (cut races):** `cutSelection` wrote a server result back over a plater that may have changed
  meanwhile. A `cutBusy` flag refuses a second request (the button is disabled) and a deleted
  object or a moved instance discards the result with an info toast and no history entry.
  **N6/N8b (undo):** history snapshots copied every paint array of every object (up to 50 copies per
  painted object); snapshots now share the arrays and the paint action copies one before its first
  write (copy-on-write), so fifty drags allocate no paint arrays. Import, duplicate and
  add-instance each record one undo step and arrange inside it instead of adding a second.
  **N8c/B1:** the keepalive autosave compares the request's **byte** length with the 60 KiB budget
  and writes its pending marker before the local cache write; the plater disposes the height-range
  slab materials (not only their geometries) when an instance or a slab layout goes.

- **Web (T-051 – plater slice split, three.js boundary):** `state/slices/plater.ts` shrank from
  35.4 KB to 2.0 KB and is now the composition only: the actions live in `objects`, `volumes`,
  `instances`, `transform`, `split` and `merge` next to `paint`, `ranges`, `cut` and `profile`, all
  spread into the same plater slice (`SlicePart<XSlice>`), so every public action name and
  `window.webslicer` stay unchanged. three.js imports are restricted by ESLint to `web/src/three/**`
  (plus a type-only import in `state/types.ts`): the camera maths moved to
  `three/viewer/cameraMath.ts`, the face-rotation quaternions to `three/faceRotation.ts`, the pure
  geometry readers and paint codecs to `plater/meshInfo.ts`/`plater/paintCodec.ts`, and
  `instanceBounds` returns a plain `{ min, max }` box. No file in `state/**` imports a `three/**`
  module at runtime; the store reaches three.js only through `plater/meshOps`, and the viewer
  registers its thumbnail renderer through a setter (`state/thumbnailRenderer.ts`) instead of a
  store field. The upload try/catch and error toast exist once (`state/upload.ts`). Behaviour,
  undo steps and `sliceDirty` are unchanged (`store.test.ts` passes untouched).

- **Server (T-050 – one router per resource, typed contract):** `routes/api.ts` shrank from 22.9 KB to
  1.7 KB and now only mounts the resource routers (`meta`, `presets`, `models`, `jobs`, `printers`,
  `exports`, `autosave`, plus the existing `library` and `projects`). Route logic moved into
  `server/src/services/` (preset context and key filtering, meta info, SSE, cut/STEP orchestration,
  printer masking, export/autosave 3MF building, job use cases); an ESLint
  `no-restricted-imports` rule forbids `routes → slicer/jobs`, so the boundary cannot regress.
  `jsonStore` moved to `server/src/storage/` and `ProjectPresetRef` lives with its schema, removing
  both import cycles. Request schemas that parse a shared type are checked against it
  (`z.ZodType<CutRequest>`, `z.ZodType<Config>`), and every JSON success body goes through the typed
  `sendJson<T>`, so a contract drift is a compiler error. Behaviour is unchanged
  (`routes/http.test.ts` untouched).

- **Safety (T-049 – G-code preflight hardening):** the preflight now sees what Marlin sees and knows
  more of the dangerous commands. **Line ends:** the scanner splits on `\r\n`, a lone `\r` and `\n`
  (a reproduction showed PrusaSlicer 2.9.6 turns a lone `\r` in `start_gcode` into a real line break),
  a `\r`/`\n` pair split across two chunks stays one line end, and `M 500` – Marlin accepts a blank
  after the letter – is the command `M500` instead of an unrecognised word. **Limits where they
  matter:** the preflight result records the highest hotend and bed temperature the file asks for, so
  the send gate compares it with the **target printer's** `safety.maxHotend`/`maxBed` (previously only
  temperatures above the global 450/150 °C ceilings were ever seen); a stored result without the
  field is re-scanned (`PREFLIGHT_VERSION` 2). `checkConfigLimits` runs on the **merged** config, so a
  `temperature`, `bed_temperature` or `nozzle_diameter` that only a print or printer section carries
  is checked too, and per-object/per-range `layer_height` overrides are checked with the nozzle rule.
  **New rules:** `M121` (endstops off) and Klipper `SAVE_CONFIG` block; `M302` blocks only in its
  unconditional forms (`M302`, `M302 S0`, `M302 P1`) because `M302 S155` ships in 18 Prusa printer
  presets; the temperature ceiling also covers `M303` (PID target), `M141`/`M191` (chamber, new
  100 °C limit), RRF `G10`/`M568` and Klipper `SET_HEATER_TEMPERATURE … TARGET=`. A section value
  with a lone carriage return is refused (400 / writer guard): PrusaSlicer's INI has no such line
  end, so the commands behind it would be hidden. Sweep over all 1763 print + 1066 printer presets of
  the bundled 2.9.6: 0 blocking findings from the new rules; the pre-existing rules flag 25
  `no_homing`, 44 `M211 S0`, 8 `M502`, 4 `M92`, 2 `M500` and 12 macro-before-move warnings – all in
  third-party start G-code and all present before this change.

- **Slicer (T-048 – one seam for every PrusaSlicer call):** the CLI argument lists now live in
  `server/src/slicer/commands.ts` (`exportGcodeArgs`, `exportStlArgs`, `cutArgs`, `helpArgs`) and are
  pinned by unit tests, so a PrusaSlicer version change that renames a flag is one edit in one file.
  `cleanLine`/`failureLine`/`withTempDir` exist once in `slicer/cli.ts`, and the 3MF `<mesh>` reader
  moved to `slicer/threemf/mesh.ts` for both the headless import and the cut tool. A new in-module
  semaphore limits **all** PrusaSlicer processes – slicing jobs, STEP conversion, cut and the
  headless STEP import – to `MAX_CLI_PROCESSES` at once (default `MAX_JOBS`); further calls wait
  FIFO. STEP and cut requests kill their process and remove the temp directory when the client
  disconnects, SIGTERM/SIGINT stops them too, a converted STEP larger than `MAX_UPLOAD_BYTES` is a
  400 instead of an unbounded read, and the 400 messages replace the temp directory with `<tmp>`.

## 1.0.0-rc.3 – 2026-10-23

- **Updates (T-058 – "a new version is available"):** a self-hosted install now notices when the
  repository has moved on, without ever updating itself. The **server** checks `GET
/api/update-status`: about a minute after start and then daily it asks the GitHub REST API for the
  head of the branch the build came from (`GIT_BRANCH`, default `main`) and for the newest release
  tag, compares the head with the build's `GIT_COMMIT` (via `/compare/<sha>...<branch>` `ahead_by`)
  and reports `current`, `latest`, `behind`, `url`, `checkedAt`, `enabled` and the tag. A newer tag
  wins over a commit count; `unknown` (a build without a stamp) only reports tags. The answer is
  cached in memory and in the data dir, the single check is timeout-bounded (5 s) and **failure is
  silent** – offline, rate limit or a 403 keeps the last result, logs at debug and never blocks or
  crashes anything. The contract (`shared/src/types/update.ts`) is validated by hand in `shared`
  (which stays dependency-free) and by a runtime check on the server. The **UI** is a quiet chip in
  the top bar ("Update available · 3 commits behind" / "· v1.1.0", accessible `role="status"` with
  a label and a link to the compare/release page) plus one row in the About dialog; the ✕ dismisses
  it for that `latest` only (`localStorage`), a newer commit shows it again, and nothing appears when
  the install is current or the check is off. **Opt-out and privacy:**
  `WEBSLICER_UPDATE_CHECK=off` stops every outbound request. The image learns its commit and branch
  through the `GIT_COMMIT`/`GIT_BRANCH` build args (CI and the Proxmox installer pass them, Compose
  reads them from the environment); the installer also refreshes them in
  `/etc/webslicer/webslicer.env` on every update. No new runtime dependency – the check uses the
  global `fetch`.

- **Docs (T-056 – short README, grouped documentation, generated screenshots):** the README is a
  landing page now (pitch, hero image, feature highlights, quick start, a tour with five screenshots,
  a documentation index, contributing, license – 110 lines instead of 500). Its details moved into
  `docs/installation.md`, `docs/configuration.md`, `docs/mcp.md` and `docs/development.md`, and the
  safety rules (configuration limits, G-code preflight, send gate) into `docs/safety.md`; no content
  was dropped. The images in `docs/images/` come from `npm run docs:screenshots`
  (`e2e/scripts/screenshots.ts`): Playwright drives the Docker image with the fixture data and writes
  indexed PNGs, so they can be refreshed after a UI change.

- **Plater (T-055 – tool bar labels, tidier sidebar):** the left tool bar names its tools now. The
  registry carries a short **`label`** per tool ("Move", "Rotate", "Scale", "Place on face", "Cut",
  "Paint supports", "Paint seam", "Paint extruder", "Layer height"), and the bar shows it next to the
  icon while the 3D view is **at least 1100 px wide** – measured on the view (`ResizeObserver`), not
  on the window, so the sidebar and the planned mobile layout change it correctly. Below that the
  bar stays icon-only with the existing tooltips, and the bar never covers more than ~170 px of the
  view. A **toggle at the end of the bar** ("Show tool labels" / "Hide tool labels") overrides the
  width either way and the browser remembers the choice (`webslicer.toolLabels` in `localStorage`,
  try/catch). The **object toolbar** of the sidebar no longer repeats the tools: move, rotate, scale,
  place on face and cut were removed from it (and from Simple mode), so every action exists once –
  the sidebar keeps only object actions (undo/redo, arrange + settings, instances, merge, duplicate,
  delete, delete all). Shortcuts and the About dialog are unchanged.

- **Plater (T-046 – tool framework):** the tools of the plater now live in a **left tool bar** at the
  edge of the 3D view, and each one opens its own **panel** docked next to the bar (at most 320 px
  wide, scrolling body, sticky footer for the primary action). Cut, place on face, paint supports/
  seam/extruder and variable layer height moved out of the sidebar into those panels; move, rotate
  and scale stay gizmo-only but have their bar entry. One tool is open at a time: its own button, the
  panel's ✕ and **Esc** close it, and opening another tool closes the first (the cut plane, the paint
  brush and the face picking all follow from that one state). Disabled tools show their reason as the
  tooltip (`Cut (C): Remove modifiers and parts first`). The tools come from **one registry**
  (`web/src/tools/registry.ts`: id, title, icon, group, panel kind, shortcut, About position,
  availability, enter/exit) – the bar, the shortcut table and the About dialog are generated from it,
  so a new tool is one entry there (proven by unit tests with a dummy definition). The old ad-hoc
  flags (`paintMode`, `placeOnFace`, `cutOpen`, the layer-height panel flag) are gone; the store has
  a `tools` slice with `activeTool`, `openTool` and `closeTool`. Panels share one frame
  (`components/tools/ToolPanel.tsx`) and the slider/toggle/section blocks in
  `components/tools/fields/`; layout is CSS-only, so the planned mobile bottom sheet (P3) only
  overrides the panel's position. The sidebar no longer renders tool options.

- **Plater (T-045 – variable layer height):** every object can carry a continuous layer height profile
  like PrusaSlicer's "Variable layer height". The new panel in the object manipulation shows the
  profile as a Z/height chart and offers **Adaptive** (quality slider 0–1), **Smooth** (radius, keep
  minimum) and **Reset**; dragging in the chart adds or subtracts layer height with a brush. The
  algorithms are pure functions in `shared/src/plater/layerProfile.ts`, modelled on PrusaSlicer's
  `SlicingAdaptive` and `LayerHeightProfile`: the adaptive walk takes the smallest layer height the
  facets crossing each layer allow, a second pass keeps facet boundaries, flat tops/bottoms become
  layer boundaries, and every height is clamped to the printer's `min_layer_height` /
  `max_layer_height` (25 % / 75 % of the nozzle when the option is 0). An object with a profile is
  coloured by layer height in the 3D view, reusing the preview's height gradient. The profile travels
  to the slicer in PrusaSlicer's own 3MF file (`Metadata/Slic3r_PE_layer_heights_profile.txt`, a
  verified source detail – the task text named it `Prusa_Slicer_…`, which the reader accepts too),
  is read back on project import, and wins over height ranges for the layer height while a range's
  other settings still apply in their band. Every Adaptive/Smooth/Reset/brush action is one undo step
  and marks the plate for a new slice; the G-code preview's "Height" view shows the resulting layer
  bands. A generated `sphere_30mm.stl` sample ships for trying it.

- **Plater (T-044 – cut tool):** the selected object can be cut with a plane (**C** or the scissors in
  the object toolbar). The panel sets the height along the object's own Z axis (slider and numeric
  field) and two tilt angles (X/Y); a translucent plane in the 3D view shows where the cut runs. The
  options are the ones PrusaSlicer offers – keep both/upper/lower, "place on cut" (the cut face of
  each part goes onto the bed) and "flip upper part". The cutting runs on the server with the
  PrusaSlicer CLI (`--cut`), like the STEP conversion: the mesh is turned into a frame where the plane
  is horizontal (shared matrix maths), cut, and both results are turned back and placed in the world –
  so the caps stay closed and no mesh code lives in the app. The new `POST /api/cut` (zod-validated)
  answers with one or two new model ids, each in its own coordinates plus the world position of its
  origin; each kept part becomes an object of its own at that position. Objects with modifiers or parts
  are refused (the button says "Remove modifiers and parts first"); paint and height ranges are dropped
  with an info toast, because the triangles they painted do not survive the cut. One Ctrl+Z restores
  the uncut object. Connectors (dowels/buttons) are still open.

- **Plater (T-043 – arrange settings and "arrange selection"):** Arrange gained a gear with the
  settings PrusaSlicer offers: the spacing between objects in mm (an empty field keeps using the
  print profile's value), "enable rotations" (the packer turns an item by 90° when that makes it
  fit or pack tighter) and the alignment of the packed block (center, as before, or the bed
  corner). The settings are remembered per browser in `localStorage` (try/catch, so a private
  window still works). **Shift+A** arranges only the selected objects/instances into the free space:
  everything unselected stays exactly where it is and is treated as an obstacle, and a selection
  that does not fit reports "The selected objects do not fit on the bed" without touching the
  plater. Both features extend the one shelf packer in `shared/src/plater/packing.ts` (new
  `spacing`, `rotations`, `alignment` and `fixed` options, defaulting to the old layout), so the
  headless `POST /api/projects/:id/arrange` and the `webslicer.arrange` MCP tool take the same
  spacing/rotations/alignment and produce the same result.

- **Plater (T-042 – merge, object info, rename):** two or more selected objects can be merged into
  one (toolbar button; only objects with a single instance – the button says why it is disabled). The
  first selected object keeps its settings, paint and height ranges; every other object becomes a
  `ModelPart` volume at exactly its world position (the volume matrix is `target⁻¹ · source · part`,
  re-centred on its own origin so slicing is unchanged), and dropped paint/ranges are reported in an
  info toast. Each object row now carries an info line – size, volume in cm³ (signed volume of the
  welded triangle soup), triangle count, instance count and, in yellow, `Not manifold – N open edges`
  – computed by pure helpers in `shared/src/math/mesh.ts` and shown in the manipulation panel too.
  Object and volume names can be edited in place: double-click the name or press F2 on the selected
  object, Enter or blur saves, Esc cancels (the shared shortcut table gained the `rename` entry),
  and the names round-trip through the 3MF project.

- **STEP import (T-009, P2):** `.step` / `.stp` files can be imported like STL – through **Import**,
  drag & drop, the library and the headless project API. The browser cannot read STEP, so the file
  goes to `POST /api/convert/step` (raw body, `x-filename` like the model upload, the same size
  limit, a 120 s timeout) where the PrusaSlicer CLI converts it with `--export-stl` inside a temp
  directory that is always removed; the returned binary STL then takes the normal STL path, so size,
  placement and slicing behave exactly as for an STL. A toast says "Converting …" while the server
  works, and a broken file is a **400** naming the CLI's first relevant log line (no hanging
  request, no temp files). The headless plater (`server/src/plater/meshes.ts`) converts through the
  same module without an HTTP round trip, and the library lists STEP files as models. The image now
  ships a small generated `calibration_cube_20mm.step` sample (15 kB, OCCT export of a 20 mm box).

- **Safety (S1-e – configuration limits in the UI):** the checks the server runs before slicing
  (S1-d) now run in the editor as well, over the presets the plater would send and through the same
  shared `checkConfigLimits` – no second copy of any limit. A blocking value (hotend/bed/chamber
  temperature, nozzle diameter, layer height above twice the nozzle) reddens the field with the
  allowed window under it and disables **Slice now**, whose tooltip lists the reasons; a soft range
  of the filament type only turns the field yellow and adds a warning badge, and the slice still runs
  with the server's warning on the job as before. The sidebar lists every issue and a click opens the
  settings tab at that field (raising the visibility mode when the option is hidden, and selecting
  the extruder of a multi-material issue). The check is debounced (150 ms) and memoised per config
  combination, so typing stays responsive. The server remains the authority.

- **Maintenance (T-040 – quick wins from the external review, Q-006):**
  _Layers:_ the audit log lives in `server/src/services/audit.ts` (it serves the MCP tools and the
  send overrides, not only MCP), `objectIsOutside` is a pure helper in `web/src/plater/plateCheck.ts`
  instead of a three.js module, and the project cleanup is registered through an explicit lifecycle
  hook (`registerProjectLifecycle`) instead of a module side effect.
  _Duplicates:_ one preset-type list (`PRESET_TYPES`/`isPresetType`) and one `safeName` in `shared`,
  used by the server and the web app.
  _Configuration:_ numeric environment variables that are not a number or below their minimum fall
  back to the default with a log warning instead of becoming `NaN`; `SIGTERM`/`SIGINT` stop the
  server accepting requests, cancel queued and running jobs, remove their temp files and exit with
  code 0 (a cleanup that hangs is cut off after 5 s, a failing one exits with 1).
  _CI:_ the workflow declares read-only `permissions:`, Dependabot opens weekly grouped updates for
  npm and GitHub Actions, linting is type-aware (`no-floating-promises`) and the server tests are
  type-checked.
  _Accessibility:_ toasts are announced in a polite live region; the settings tabs are a real
  `tablist` with `role="tab"`, `aria-selected`, arrow/Home/End keys and `tabpanel`.
  _Version and policy:_ one version source (root `package.json`, synced by `npm run version:sync` and
  checked by `npm run version:check` in CI) – the image no longer hard-codes it – and a `SECURITY.md`
  with the reporting channel and the supported versions.

- **Fixed (T-039 – GPU and memory resources):** leaks and lost work from the external review.
  _Preview and bed:_ clearing the G-code or the bed group disposes the geometries, materials and
  textures it held; removing objects also frees the plater geometry that is no longer used, so
  `renderer.info.memory.geometries` returns to its start value after load → slice → clear and after
  adding and removing ten objects (undo still restores geometry because three re-uploads a disposed
  buffer on the next render).
  _Thumbnails:_ embedding the preview thumbnails no longer reads the whole G-code file into memory.
  _Uploads:_ the "waiting for upload" loop gives up with a clear message after 60 s instead of looping
  forever, watching a new job closes the previous event stream, and an older preview download can no
  longer overwrite a newer one.
  _Arc fitting:_ G2/G3 moves in the preview (emitted by PrusaSlicer's `arc_fitting`) are interpolated
  into straight segments with a chord error of at most 0.05 mm (`I`/`J` or `R`, full circles included)
  instead of being skipped, so fitted perimeters and infill are visible and their time and filament
  numbers are right.

- **Security (T-039 S7 – uploads and 3MF bombs):** model and library uploads are streamed to a temp
  file and the size limit is enforced while the bytes arrive (no whole body in RAM; a body over the
  limit answers **413** and leaves no file, an aborted upload removes its temp file). STLs are parsed
  from the streamed file in chunks. A 3MF is checked against its central directory before anything is
  inflated: the entry count and the declared total uncompressed size are capped (10 000 entries,
  1 GiB), and every entry read is checked again, so a zip bomb is refused instead of exhausting
  memory.

- **Fixed (T-038 – data loss and crashes):** bugs from the external review of 2026-10-22.
  _Extruders:_ every extruder index is clamped after the count shrinks, so reducing the extruders no
  longer throws and values fall back to extruder 1 (object/volume extruder, paint, reset, discard,
  save-as).
  _Undo/redo:_ history snapshots deep-copy the MMU, support and seam paint arrays; undoing a stroke
  restores exactly the previous paint instead of dropping the object's MMU paint.
  _Presets:_ an `inherits` cycle (a preset inheriting itself or a longer loop) is detected while
  resolving, refused with **400** when saved, and a cycle already on disk is skipped with a log
  warning instead of taking the whole preset list down with a 500.
  _Jobs:_ cancelling works in every stage – including while the model is still being prepared – and
  deleting a running job waits for the slicer to stop and for its temporary files to be removed; the
  UI shows one "Slicing cancelled" toast instead of a red "Slicing failed". On Windows a `.cmd`/`.bat`
  slicer wrapper is killed as a process tree, so the real slicer cannot keep running.
  _Data files:_ every JSON store (printers, projects, MCP tokens, installed printers) and the user
  preset files are written to a temp file and renamed; an unparseable file is moved aside as
  `<name>.corrupt-<timestamp>` and logged instead of being read as empty and overwritten by the next
  save. The token file keeps mode 0600.
  _Keyboard:_ shortcuts do nothing while a modal dialog is open or an input has focus (previously
  Delete, Ctrl+Z or A acted on the plater behind a dialog).
  _HTTP and UI:_ `POST /api/export/3mf` and `/api/export/config` answer **400** with the validator
  message on an empty or invalid body (was 500 / an unchecked body), any zod validation failure is a
  400, a malformed `X-Filename` no longer escapes as a 500, the job queue is loaded before the server
  listens, and the bed shape editor re-reads the current printer's shape after a printer switch
  instead of writing the old one back.

- **Security (T-037 S3–S10):** hardening from the external review of 2026-10-22.
  _S3 – print hosts:_ a printer test gives up after 5 s, an upload after 60 s plus 1 s per 50 kB with
  a 10 min maximum; error bodies of OctoPrint/Moonraker/PrusaLink are no longer echoed to the client
  (the answer names the HTTP status, the body goes to the server log) and connection errors keep a
  generic message.
  _S4 – AppImage checksum:_ `Dockerfile` and `proxmox/install.sh` pin the SHA-256 of the default
  PrusaSlicer 2.9.6 AppImage per architecture and abort before extracting it when it does not match
  (the installer runs it as root). A custom `PRUSASLICER_URL`/version needs `PRUSASLICER_SHA256`;
  without it the download is unverified and the log says so.
  _S5 – update channel:_ unchanged by decision – installs keep following `main`; the README now shows
  how to pin a release tag with `WEBSLICER_BRANCH`.
  _S6 – licensing:_ the repo has the `LICENSE` (AGPL-3.0-or-later, as `package.json` says) and a
  generated `THIRD_PARTY_NOTICES.md` (PrusaSlicer with its source link, all JavaScript production
  dependencies); the Docker image and the LXC install carry both.
  _S8 – MCP bands fail closed:_ an empty or non-numeric preset value, a non-numeric value or a
  percent/absolute mismatch now rejects the change with a reason instead of accepting any value.
  _S9 – MCP tokens:_ tokens are stored as SHA-256 instead of scrypt (a junk `Authorization` header no
  longer blocks the event loop); old scrypt records still work and are upgraded on first use; the
  10th failed authentication of one address within a minute answers **429** with `Retry-After`,
  and a correct token clears the count.
  _S10 – library paths:_ every library path is now checked after resolving symlinks, so a link on a
  NAS share cannot reach outside the library; refusals stay a plain `invalid path` and **500**
  answers carry a generic `Internal error` (details only in the server log).

- **UI (T-036):** the object toolbar no longer uses the tiny Unicode glyphs. Each action has a real
  SVG icon (`lucide-react`, web only, named imports) at 18 px with a ≥ 30 px hit area, and the tooltip
  with the shortcut stays the `aria-label`. The toolbar is grouped (history | move/rotate/scale/place
  on face | arrange/instances | duplicate/delete) with small separators, wraps to a second line at the
  narrowest sidebar width instead of shrinking the icons, and Simple mode shows the same icons. The
  same plater actions use the same icon everywhere: the object row (`+` add volume, split to
  objects / parts), the instance rows (separate object, split, delete), the preset row (save, discard,
  delete), the height-range rows, reset-to-preset, dialog close/remove.

- **Session restore (UX):** opening WebSlicer again shows the last plater right away. After a reload –
  and after the browser was closed and reopened – the objects, instances, volumes, paint, height
  ranges, custom G-codes, the selected presets (unsaved modifications included), the plater/preview
  tab and the projection are back without a click; a toast says "Previous session restored" and
  offers **Start empty**, which clears the plater and drops the autosave so the next reload stays
  empty. The old "Unsaved session found – Restore/Discard" notice is gone; it only shows (with the
  error and a Retry) when the automatic restore failed. The server autosave stays the source of
  truth; a pending save is flushed on `visibilitychange → hidden` / `pagehide` with
  `fetch(…, { keepalive: true })`, so the last seconds before a reload are no longer lost, and a
  request larger than the 64 KiB keepalive budget is kept in IndexedDB and written on the next start.
  "Delete all", "Start empty" and a new import replace the stored autosave. Two tabs: last write wins
  (no tab sync).

- **Safety (S1-d):** settings are now checked before the slicer runs, and a print host can carry its
  own limits. `POST /api/slice` (and the project slice, and the MCP `slice` tool) run the new
  `shared/src/safety/configLimits.ts` over the request: a hotend temperature outside `0` or
  150–450 °C, a bed outside 0–150 °C, a chamber outside 0–100 °C, a nozzle outside 0.1–2.0 mm or a
  layer height that is not a number, ≤ 0 or more than 2× the nozzle answers **400** with the issues
  (`{ error, issues }`, each with `rule`, `severity`, `message`, `key`, `value`, `limit`). Per-extruder
  vectors are checked element-wise (`temperature = 215,2150` names the second one), `nil` and missing
  keys are skipped, and `0` stays allowed as PrusaSlicer's "off". Values outside the _usual_ window of
  the `filament_type` (PLA, PETG, ABS/ASA, TPU, PA, PC – the ranges come from the 2.9.6 system
  profiles) only **warn**; the warnings are returned with the job (`configIssues`) and listed in the
  preview. The MCP `set_settings`/`check_settings` report the same limit issues on top of their S1-a
  bands. A physical printer has a new optional `safety: { maxHotend, maxBed }` (zod-validated, editable
  in the dialog with a "PTFE hotend (max 240 °C)" button); the send gate compares the job's
  temperatures with it (`send.printer_limit`, **block**, overridable with a reason and audited) and
  passes the limits to the preflight when an older job has to be re-scanned. A job from before this
  change is judged on its stored request. `server/scripts/limits-sweep.ts` checks every bundled
  PrusaSlicer 2.9.6 system preset with the same rules – 0 blocking findings.
- **Plater:** a plate is checked before it is sliced, the way PrusaSlicer's GUI does it, instead of
  failing after a long job. The new pure `web/src/plater/plateCheck.ts` tests every printable
  instance's footprint against the **real bed polygon** (an object in the cut corner of an L-shaped
  bed is outside now, not only past the polygon's bounding box), adds the **brim** (`brim_width`)
  and the **skirt** (distance plus loop widths over all objects) and reports what leaves the print
  area, a too-tall object, a toolpath conflict between two instances and – with
  `complete_objects` – a pair closer than `extruder_clearance_radius`. The slice panel lists the
  issues; a blocking one disables **Slice now** with the reason in its tooltip, and the affected
  objects keep the red row. The rules were measured against PrusaSlicer 2.9.6: the slicer refuses
  an off-bed object ("All objects are outside of the print volume.") and colliding toolpaths
  ("gcode path conflicts found between …", a penetration of more than about 2 × the first-layer
  extrusion width), while it accepts overlapping objects in normal mode and sequential printing
  below the clearance radius – those stay allowed or warn. A job the slicer still fails now shows
  the slicer's own wording instead of a generic failure.

- **Security:** a slicer option key is now validated instead of filtered by name. SEC-1 dropped
  `post_process` and `output_filename_format` by an exact match on the raw client key, while the INI
  writer wrote the key unescaped – a key such as `"x\npost_process = echo pwned"` therefore wrote a
  second line into the `config.ini` that PrusaSlicer loads with `--load`, and the slicer ran that
  command as the service user (remote code execution, reachable from the LAN and, through DNS
  rebinding, from any website a LAN user opens). Now one rule – `isValidConfigKey` in
  `@webslicer/shared` (`^[a-z][a-z0-9_]*` plus a bracketed vector index such as
  `dynamic_overhang_speeds[0]`, which the bundled Sovol presets use) – is applied at three layers:
  the REST/MCP validation rejects a malformed key with **400** and the key in the message
  (`/api/slice`, `/api/presets/:type/:name`, `/api/projects`, `/api/library/project`, MCP
  `set_settings`); `mergeConfigs` drops every key that is malformed, server-only, or unknown to the
  installed slicer; and `serializeIni` refuses a malformed key outright. Unknown-but-well-formed keys
  are dropped rather than rejected, so old projects and presets keep loading. The same change adds
  the **Host/Origin guard**: `/api` and `/mcp` refuse a request whose `Host` is not `localhost`, a
  loopback address, an IP literal, one of this machine's interface addresses or a name from the new
  `ALLOWED_HOSTS` env variable (403); a browser `Origin` has to name an allowed host too. The MCP
  router's old `Origin == Host` check is gone – a rebound name always passed it. An install opened by
  IP, by host name or through a reverse proxy keeps working (`ALLOWED_HOSTS=webslicer.lan,nas`).
- **Safety (S1-c):** the G-code WebSlicer produces is now scanned before it can be sent. When a job
  finishes, the server reads the output file once (chunked, no full-file string; 0.7 MB in ~56 ms,
  60 MB in ~3.6 s) and stores the findings on the job (`info.preflight`, versioned). Five rules:
  `gcode.forbidden_command` (**block**) – `M500`, `M502`, `M211 S0`, `M92`, `M997`, `M851`, i.e.
  commands that store or reset the EEPROM, disable the endstops, change the steps/mm, flash firmware
  or move the probe offset; `gcode.max_temp` (**block**) – `M104`/`M109` above 450 °C and
  `M140`/`M190` above 150 °C (wide typo catchers; S1-d adds the per-printer limits);
  `gcode.no_homing` (**block**) – a move with X/Y/Z before the first `G28`, with
  `gcode.macro_before_move` (**warn**) instead when a printer macro (`PRINT_START`, …) comes first,
  because it may home; `gcode.firmware_limit` (**warn**) – `M201`/`M203`/`M204`/`M205` above the job
  printer preset's `machine_max_*` (Normal column, only when the preset defines them); and
  `gcode.motor_current` (**warn**) – `M906`/`M907`. The last one is a warning rather than a block on
  purpose: PrusaSlicer's own printer presets write `M907 E430`/`M907 E538` into their start and end
  G-code, so blocking it would refuse every file the slicer makes for an MK3S. Comments, lowercase
  and line numbers are understood (`M5000` is not `M500`), a finding carries its line number and the
  offending line, and each rule keeps its first five findings (the counts keep the total). Binary
  `.bgcode` output is not read and reports one `gcode.not_scanned` warning.
  The send gate merges these findings with the S1-b preset issues: a blocking finding answers
  **409** `{ error, issues }` (each issue now carries `line` and `text`), goes through with
  `{ "override": true, "reason": "…" }` and is written to `data/audit.log` like a preset mismatch. The
  send dialog lists the findings next to the preset issues with their line; the preview panel shows
  "Preflight: n blocking, m warnings" with the details in a collapsible section.
- **Testing:** the browser checks that so far lived in git-ignored `.claude/*-browser.mjs` scripts are
  in the repository as a Playwright suite (`e2e/`, `@playwright/test` 1.64.1 pinned, Chromium only,
  `retries: 0`, one worker). `npm run e2e:docker` builds the image, starts it with the fixture data dir
  (`e2e/fixtures/data`: an installed MK3S and no physical printers) and runs everything; `npm run e2e`
  runs against an app that is already up and has **no default target** – it refuses any instance
  without the fixture marker preset, because the suite deletes jobs and writes presets. The send tests
  upload to a **mock print host** (`e2e/mock-host`, a sibling container on a private network) – a real
  printer is never contacted. CI gets a second job, **sharded over three jobs**, that builds the image
  with the GitHub cache and runs its share of the suite. `docs/` and the product code are unchanged;
  the suite found two pre-existing 500s on `/api/export/3mf` and `/api/export/config` with an empty
  body, which are pinned as they are.

- Refactoring cleanup (R-12), no behaviour change: the web UI formats numbers, times and sizes
  through one `web/src/format.ts` instead of per-call-site helpers (the output strings are pinned
  by a unit test), exports that nothing imported are gone (`objectBounds`, `PAINT_NONE`,
  `TOOL_NAMES`, `resetSchemaCache`, … – see `.ai/reports/T-029.md`), the last runtime import cycle
  of the web store is broken (the autosave restore now lives in `importFiles.ts`), the volume type
  list is read from the shared `VOLUME_TYPES`, and 44 non-null assertions in non-hot paths became
  ordinary guards. No visible behaviour change: the T-017 and T-018 browser suites give the same
  DOM, the same values and pixel-identical screenshots on `main` and the branch.
- Refactoring of the slicer modules (R-11), no behaviour change: the three oversized files in
  `server/src/slicer/` are split by responsibility. `layout.ts` (1003 lines) became
  `slicer/layout/` – the curated tab table (`fff.data.ts`), the option metadata
  (`knownOptions.data.ts`), the vector key sets (`keySets.ts`) and the types. `threemf.ts`
  (596 lines) became `slicer/threemf/` – `mesh.ts` (STL parsing/writing, `transformMesh`),
  `read.ts`, `write.ts`, the custom G-codes and the shared XML helpers. `schema.ts` (424 lines)
  keeps the builder and hands the help parser (`help.ts`) and the per-option derivation
  (`optionDef.ts`) over. The code was moved, not rewritten: every function body is unchanged and
  two new pin tests (a `buildSchema` snapshot from the checked-in 2.9.6 help output and a written
  3MF compared entry by entry) hold the output byte-identical. The settings UI, `/api/schema` and
  every written 3MF are the same files as before.
- **Toolchain:** the web app runs on **React 19** (`react`/`react-dom` 19, matching `@types/react`)
  and **Vite 7** with `@vitejs/plugin-react` 5. `eslint-plugin-react-hooks` is on 7 with the same
  two rules as before, so no lint outcome changes. No behaviour change: the only forced code edit is
  the ref typing in `three/viewer/useScene.ts` (`MutableRefObject` was removed in React 19, where
  `RefObject.current` is writable). `StrictMode` stays.
- **Safety (S1-b):** sending G-code to a print host now checks that the host is the machine the file
  was sliced for. A physical printer can be linked to a printer preset (Printers → Edit → "Printer
  preset"); `POST /api/jobs/:id/send` compares that preset with the job's own printer preset and
  refuses a mismatch with **409** `{ error, issues }` – the G-code's start/end G-code, axis limits and
  nozzle belong to another machine. Presets are compared by lineage: the same name or a system preset's
  alias is the same machine; a preset that inherits the other (directly or through a chain) warns with
  `send.preset_derived`, because a derived preset can change the nozzle, axis limits or start/end
  G-code; two presets that only share an ancestor (siblings) are a mismatch and are blocked. A host
  without a preset only warns, because there is nothing to compare. A refused send is still possible
  with an override: `override: true` plus a reasoned text (trimmed, at most 500 characters, required) is
  accepted and written to `data/audit.log` (job, host, issues, reason, time) in the MCP audit format.
  The send dialog preselects the host that fits, lists the issues, asks for the override with its
  reason and, when "Start printing after upload" is ticked although a warning is shown, for an extra
  confirmation. Files that were sendable before are sendable unchanged when the host is linked to the
  matching preset – the REST contract apart from the new 409 and the two optional fields is untouched.
- **Safety (S1-a):** the MCP tools no longer let an agent prepare G-code outside the machine's
  limits. `set_settings` used to accept every key in every scope – including printer options such as
  `z_offset` or `bed_shape` – and only type-coerced the value. Now only process and material options
  are accepted (no printer scope, no G-code or script text, no multiline keys, no free text or
  coordinates), and a value has to stay near the resolved preset: temperatures ±25 °C, speeds
  ×0.5–×1.5, extrusion multiplier ±0.1, retraction length ±1 mm, per extruder element by element
  (`0` = off/auto stays allowed). A refused key rejects the whole call – nothing is partially
  applied – and the tool error lists every issue as `key: value – reason (allowed …)`. The new
  read-only tool `webslicer.check_settings` answers the same check as a dry run; rejected calls are
  logged in the MCP audit log with their reasons. `quick_settings` writes through the same path.
  The tool catalogue moved into one module per topic (`mcp/toolCatalog.ts`, `toolProjects.ts`,
  `settings.ts`, `toolJobs.ts`), behaviour unchanged; `get_option_schema` and `set_settings` describe
  the new limits. REST and the settings editor are untouched.

- **Security:** two slicer options are no longer passed on to PrusaSlicer, because the slicer acts on
  them on the **server** rather than inside the G-code. `post_process` ("Post-processing scripts") is a
  list of shell commands PrusaSlicer runs after the G-code export, and `output_filename_format` names
  the output file and accepts `..`, so it could write outside the job directory; anyone able to call
  `/api/slice`, `/api/projects/:id/slice` or the MCP `set_settings` tool could therefore run commands
  as the service user. Both keys are now dropped from every merged config – the REST slice route, the
  project slice, the MCP tools, the 3MF/config export and the autosave all go through the same merge –
  and a project no longer keeps them in its stored preset config. They are _not_ rejected as input:
  the browser's own presets, vendor bundles and 3MF projects may carry them legitimately. The MCP
  `set_settings` tool refuses them with a message that names the reason (an agent learns the rule),
  `get_option_schema` no longer lists them, and the settings editor shows them read-only with a note
  instead of an editor that would have no effect. Slicing output is unchanged for every request that
  does not set the two keys.
- Express 5, no behaviour change: the server runs on `express` 5 (`@types/express` 5). Express 5
  forwards the rejected promise of an async handler to the error handler, so the `asyncHandler`
  wrapper that every route of `routes/api.ts`, `routes/projects.ts`, `routes/library.ts` and the MCP
  endpoint was passed through is deleted instead of moved – the handlers are plain `async` functions
  now, and the error handler still answers the status and the JSON body of the thrown error (pinned
  by a test). Every endpoint, status code, body, header and file download is unchanged, checked by
  the HTTP contract tests and a `curl`-level smoke comparison of all 154 exchanges against the
  previous build, plus an MCP `tools/list` comparison and a browser pass over the deep link, the
  import, a slice with its SSE progress stream and the G-code download. One visible difference comes
  from the newer mime database: the vendor bed model is served as `model/stl` (the registered type)
  instead of Express 4's `application/vnd.ms-pki.stl`; browsers decide on the file extension, so the
  bed loads exactly as before.
- Refactoring of the request validation (R-10), no behaviour change: every payload the server accepts
  is described by one zod schema in `server/src/validation/` – the slice request (transforms,
  instances, ranges, volumes, paints, custom G-codes, thumbnails), the project create/models/arrange
  bodies, the printers, the presets, the library bodies and the job upload. The REST routes and the
  MCP tools use the same schemas, so a rule (and its message) no longer exists twice; the hand-written
  `isTransform` and the field checks in the routes are gone, and `copies` has one owner. Status codes
  and error messages stay as they were – the API contract tests and a `curl`-level smoke comparison
  of all 154 exchanges against the previous build pin them. Two payloads that used to crash the
  request handler with a 500 (an element of `objects`/`volumes`/`ranges`/`customGcodes`/`thumbnails`
  that is not an object, and a non-string `filename` in `POST /api/jobs/:id/send`) are now reported as
  the field error they are (400) or ignored, as the surrounding code already did.
- Refactoring of the server internals (R-9), no behaviour change: the server logic lives behind
  `server/src/services/` (slicing, projects, library, printers, models, config merge, autosave,
  schema, version) and no longer knows Express; the routes only validate, call a service and answer,
  and the MCP endpoint calls the same services instead of the routes. `jobs.ts` keeps the queue and
  the SSE stream, the job directory moved to `jobs/persistence.ts`. Errors carry their status as a
  type (`HttpError`/`ValidationError`/`NotFoundError`/`ConflictError` in `server/src/errors.ts`) and
  the request paths read and write with `fs/promises`, so a large file no longer blocks the event
  loop. Every endpoint keeps its method, path, status codes, headers and bodies – checked by the
  HTTP contract tests and a `curl`-level smoke comparison of all 154 exchanges against the previous
  build.
- Code quality tooling: ESLint 9, Prettier and GitHub Actions CI. `npm run lint` checks all
  three workspaces (typescript-eslint recommended, the React hook rules for `web/`, no `any`, no
  non-null assertion as a warning until R-12), `npm run format`/`format:check` enforce the
  repository style and `.editorconfig` carries it into editors. The whole repository is formatted
  in one format-only commit. `.github/workflows/ci.yml` runs `npm ci` → type check → lint →
  format check → tests → build on every push and pull request. Behaviour is unchanged; the fixes
  were unused imports and one `useMemo` dependency.
- Camera of the 3D view like PrusaSlicer: the number keys **0–6** put the camera on the standard
  views (Iso, Top, Bottom, Front, Rear, Left, Right), **K** switches between the perspective and the
  orthographic projection and **Z** zooms to the selection – the picked instance, the selected
  objects, otherwise the whole bed, and in the preview the toolpaths of the visible layers. A small
  view toolbar sits at the top right of the 3D view next to the reset-view button. Every camera
  command frames a box through the same maths (`plater/camera.ts`, unit tested without WebGL), and
  the two cameras are moved together: the orthographic frustum gets the area the perspective camera
  shows at that distance, so switching the projection keeps the framing, and the choice is remembered
  in `localStorage`. The platter no longer limits the polar angle, so the camera can go below the bed
  for the bottom view; the print bed is drawn single sided for the same reason (it used to blend over
  the model when looking from below). G-code thumbnails are unaffected – the preview keeps its own
  camera
- Preview like PrusaSlicer, part 2: the **feature legend** now shows the time, the share of the print
  time and the extruded length of every feature type, plus a Travel row with its time (travel is not
  extruded, so it has no share of its own and the shares of the other rows add up to 100 %). The times
  come from the feedrates of the G-code and are scaled to the slicer's estimate, exactly like the
  layer times in the range legends; the parser sums them per feature type while it walks the file, so
  it adds no second pass. A finished job that sliced with **warnings** shows them in a collapsible
  yellow box above the statistics instead of leaving them in the log – the server reads the warning
  blocks out of the slicer log (`print warning: Empty layer between 8.15 and 12.35.` plus the object
  name, the hint and the stability issues), deduplicates them and keeps at most 20; a clean job shows
  no box
- MCP endpoint for agents (phase 1): the server speaks the Model Context Protocol over Streamable HTTP
  at `/mcp`, so an assistant can look through printers, presets and the library, build a project and
  slice it. The endpoint exists only with a token – without `MCP_TOKEN` it answers 404, a missing or
  wrong bearer token 401. Tokens are scrypt hashes in `data/mcp-tokens.json` (the environment token is
  kept there as the owner `admin` and removed again when the variable disappears), every call lands in
  `data/audit.log` with time, token id, owner, tool and parameters but without secrets, and a token
  only ever sees the projects of its own owner. Eleven tools: `webslicer.list_printers`, `list_presets`,
  `get_option_schema`, `list_library`, `create_project`, `add_model`, `arrange`, `set_settings`
  (validated against the option schema), `quick_settings`, `slice` and `get_job`; the read-only ones
  carry `readOnlyHint`, and `set_settings` rejects unknown options and options of another preset type.
  The job result now also reports the layer count (read from the `;LAYER_CHANGE` markers of the
  G-code). The README section "MCP" documents Docker Compose, the Proxmox environment file and client
  configuration for Claude Code and Claude Desktop; `server/scripts/mcp-e2e.ts` runs the complete
  workflow (library → project → settings → slice → evaluation) against a running server
- Server-side projects (MCP phase 0): the server can build and slice a plater without a browser.
  `POST /api/projects` creates a project for a printer/print/filament preset (names plus overrides),
  `POST /api/projects/:id/models` adds an STL or 3MF from the library (3MF: one object per `<object>`,
  one instance per `<build><item>`, placed exactly where the file has them; `copies` repeats the
  instances), `POST /api/projects/:id/arrange` packs the instances with the same shelf algorithm the
  browser uses, `POST /api/projects/:id/slice` answers with a job record (no thumbnails headlessly) and
  `GET /api/projects/:id` reads the state back. A project is a JSON file in `data/projects/`, expires
  24 h after its last use and keeps its models alive; expired projects and their models are removed by
  the cleanup that runs with the model pruning. The browser UI is unchanged
- Preview like PrusaSlicer, part 1: a **horizontal slider** under the layer sliders plays the moves of
  the top visible layer one by one (at the end of its range it shows the whole layer again) and a small
  tool marker sits at the current position – moving a layer slider resets it to "end of layer". The
  **view options** below "Show travel moves" switch retractions (magenta), deretractions (cyan-green),
  seams (light grey), wipe moves (yellow lines), tool changes (red) and colour changes (blue-grey) on and
  off independently, and **Shells** draws the plater objects translucent over the toolpaths. The parser
  records the markers and a global move index per move, so a slice cut at any point of a layer is drawn
  without re-parsing; a 300 000-segment G-code stays interactive
- Unsaved-changes dialog like PrusaSlicer: switching a print, filament or printer preset while the
  current one is modified asks what happens to the changes – **Transfer** (the new preset takes them
  over and shows as modified), **Save** (the changed preset is saved under a name, then the switch
  happens), **Discard** (switch without them) or **Cancel** (stay). The dialog lists every changed
  option with label, key, old and new value; Transfer is disabled for printer presets, because those
  describe the machine. The browser `confirm()` is gone
- Split to objects / split to parts: a model made of several separate shells (a plate of parts
  exported as one STL) is split with one click into independent objects or into parts (ModelPart
  volumes) of the same object. "Split to objects" gives every shell an object of its own with the
  original settings, height ranges and per-triangle paint, and every copy of the object keeps its
  exact place; "Split to parts" keeps the largest shell as the mesh and turns the rest into parts.
  A hollow shell (an inward-facing inner wall) stays with the shell that encloses it, so a hollow
  object counts as one part, and a single-shell object reports "The object consists of a single
  part". One undo step each, buttons in the manipulation panel and in the object list
- Instances: set the number per object (1–1000), "Fill bed" places as many copies as fit, "Add instance" /
  "Remove instance" buttons and the `+` / `-` keys, a `×n` badge in the object list that expands into one
  row per instance (select, set as separate object, delete). All instances share one mesh, its volumes,
  paint and settings but have their own position, rotation and scale; slicing sends one transform per
  instance, so the slicer plans them in one job and the filament/time estimates cover all copies
- Mirror X / Y / Z buttons in the manipulation panel: they flip the picked instance, or every instance
  of the selection, about the world axis through the instance position (double mirror restores the
  original), drop the result back onto the bed, and are one undo step each. The size fields keep showing
  the magnitudes, the sign lives on the scale axis the mirror negated, and a mirrored project survives
  save, reload and desktop PrusaSlicer (the 3MF keeps the negative-determinant item transform)
- Arrange packs the instances themselves (not whole objects), so a part-placed object is filled efficiently
- 3MF projects save and restore the instances (one `<item>` per instance), so a project reopened from the
  library, the autosave or desktop PrusaSlicer comes back with the same layout
- Colour change (M600), pause (with printer message) and custom G-code at a layer: buttons at the top
  slider position in the preview, markers on the slider, editable list, automatic re-slice; stored in
  the 3MF as `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml` and read from PrusaSlicer projects
- Preview colour mode "Color print" with a legend of the colour segments
- The preview keeps the slider position when re-slicing
- Preview colour schemes like PrusaSlicer: height, width, speed, fan speed, temperature, volumetric flow
  rate, layer time (linear and logarithmic) and tool, each with a gradient legend of the value range
- Proxmox helper reworked in the style of the community-scripts: header, Default/Advanced settings
  (OS version, container type, password or console autologin, ID, hostname, disk, CPU, RAM, bridge,
  static IP/gateway, IPv6, VLAN, MTU, MAC, DNS, SSH key/root login, web port, model library bind mount,
  PrusaSlicer version, tags, verbose), storage picker with free space, step progress with spinner and
  a log file, clear error output, no password printed, `update` command inside the container; running
  the helper inside an existing WebSlicer LXC updates it
- Installer: no locale warnings, quiet npm, settings persisted for updates, service user with fixed
  uid 1050 (host uid 101050 in unprivileged containers) for bind-mounted libraries
- Helper: when the container does not start, the real LXC error is shown (debug start log); if the
  model library mount prevents the start, the install continues without it and explains how to add it
  later; the library is checked for write access with a share-type specific hint (CIFS, NFS, local)
- Helper: the LXC template is chosen for the host architecture – `pveam` also lists arm64 templates,
  and an x86_64 host could get the arm64 Debian 13 template ("Exec format error" on start)
