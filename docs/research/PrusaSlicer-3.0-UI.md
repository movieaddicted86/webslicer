# PrusaSlicer 3.0 – UI and concept research

Research for WebSlicer, 2026-10-24 (requested by Robert). Nothing here is a commitment: the adoption list
at the end is what goes into `TODO.md` / `.ai/ROADMAP.md`, and every UI/UX decision stays with Robert.

## 1. Status of 3.0 (what exists today)

| Fact | Detail |
|---|---|
| Release state | **Alpha, not official.** `3.0.0-alpha11` (2026-09-01) and `3.0.0-alpha12` (2026-09-21) are GitHub *pre-releases*; latest stable is `2.9.6` (2026-06-25). Prusa itself says alpha11 "is expected to be unstable and not polished" and "not feature complete" |
| Where | Releases: <https://github.com/prusa3d/PrusaSlicer/releases> (tags `version_3.0.0-alpha11`, `-alpha12`); source on `master` of `prusa3d/PrusaSlicer`; Linux builds only via Flathub (`flathub-beta`) |
| Side by side | Alpha writes to `PrusaSlicer3-dev`, so it can run next to 2.x |
| License | AGPLv3 (same as WebSlicer) – ideas and architecture may inform us; their C++/ImGui UI code and icon artwork are not reusable in a web app, so we redraw everything (lucide icons stay) |
| Missing in the alpha | SLA, third-party printer profiles (only Prusa printers), standalone G-code viewer, post-processing scripts, custom G-code editor, sequential arrange, 3Dconnexion, mirroring, screen-reader accessibility |

Sources read: both release notes (full text), `doc/Plugin_API.md`, `specs/presets/{preset,vendor}-schema.json`,
the repo layout (`src/`, `doc/`, `specs/`), and the nine screenshots attached to the alpha11 release notes.
The Prusa blog post linked from the notes could not be fetched in this session (search tool unavailable); the
release notes contain the same content in long form.

## 2. What the 3.0 UI looks like (screen map)

Dark theme by default, light theme available; orange (`#e0602b`-ish) is the single accent colour for primary
actions, active tool and selection; blue-grey for selected rows/cards.

```
┌────┬───────────────────────────────────────────────────────────────────────────────┐
│    │ Menu  File  💾  ↶ ↷ ▾  ▤(hide sidebars)   [ project tab ✕ ] [ tab ✕ ] [+]   🔍 Search…│
│ S  ├───────────────┬─────────────────────────────────────────────────┬─────────────┤
│ l  │ OBJECT LIST ⌃ │  [Prepare|Preview]   [add][arrange] | tool icons │ RIGHT PANEL │
│ i  │ + Printer grp │                                                  │ (context)   │
│ c  │  Printer A    │                                                  │             │
│ i  │   Bed 1 ▸objs │                3D scene                          │ Bed → printer│
│ n  │   Bed 2       │                                                  │  card, filament│
│ g  │  Printer B    │                                                  │  rows, print │
│    │   Bed 1 …     │                                                  │  preset +   │
│ C  ├───────────────┤                                                  │  ⭐ favourites│
│ o  │ (preview:     │                                                  │ Object →    │
│ n  │  Sliced info, │                                                  │  its settings│
│ n  │  Legend card) │ ◲ view cube                                      │ Tool →      │
│ e  │               │                                                  │  tool controls│
│ c  │               │                                                  ├─────────────┤
│ t  │               │                                                  │ Destination │
│ P  │               │                                                  │ [   Slice  ]│
│ r  │               │                                                  │ (→ Send to…)│
│ ⚙ 👤│               │                                                  │             │
└────┴───────────────┴─────────────────────────────────────────────────┴─────────────┘
```

### 2.1 Regions

1. **App rail (far left, ~90 px):** Slicing / Connect / Printables as full-height mode buttons; Preferences gear and the
   account avatar at the bottom. Online features are optional.
2. **Top bar:** `Menu` (hamburger with Edit, View, Plugins, Preferences, Configuration, Help), `File`, save, undo/redo
   with a history dropdown, a "hide sidebars" toggle, **project tabs** (several projects open at once, `+` for new),
   and a global **search** field at the right.
3. **Object list (left, collapsible card):** no longer misused for per-object settings. It is an *overview*:
   printer groups → beds → objects, with a thumbnail per bed, a "SLICED" badge, per-object icons for painting etc.
   "Add Printer Group" button on top. Grows with content so it covers as little of the scene as needed.
4. **Prepare | Preview** segmented switch, top-left of the scene. In Preview an extra toggle opens the G-code viewer.
5. **Tool strip (top centre, floating pill):** add/arrange on the left, then delete, copy, move, rotate, scale, place on
   face, cut, split, measure, supports paint, seam paint, colour paint, text, layer-height range, variable layer height
   … one icon each, active tool highlighted orange. Icons only, tooltips on hover (like our T-046 bar, which has labels
   on wide screens).
6. **Right panel (context sensitive):** shows the *selected thing*:
   - **Bed selected** → printer card (image, model, variant) · filament rows (colour dot, filament, nozzle) ·
     print preset dropdown + gear for the full settings dialog · a short list of **favourite settings** grouped
     (Walls & Perimeters, Infill, Bed adhesion, Supports) · destination card · big **Slice** button at the bottom.
   - **Object selected** → that object's settings (replaces the old object-list tricks).
   - **Tool open** → the tool's controls live here (e.g. *Multimaterial painting*: extruder palette 1-8, tool buttons,
     shape, brush size with slider, clipping, "split triangles", key-hint list with `SHIFT +`, `X`, `ALT +` chips).
     2.x used floating in-scene dialogs; those are gone.
7. **View cube (bottom-left of the scene)** for camera orientation; also configurable camera mouse bindings
   (PrusaSlicer, Blender, Tinkercad, Fusion, SolidWorks schemes).
8. **Preview mode extras:** left cards *Sliced info* (used material g/m/mm³, print time) and *Legend* (feature-type
   colours, drop-down to switch the colour scheme, *Detail view* toggle); a **G-code viewer** card on the right with
   line numbers following the sliders; vertical layer slider with height + layer number at both handles; horizontal
   move slider with move indices; **Auto-reslice** toggle above the destination card.

### 2.2 The settings dialog (opened by the gear)

Modal card, left **category list with icons** (Layers & Surfaces, Walls & Perimeters, Infill, Bed adhesion, Supports,
Speed, Motion & Dynamics, Extrusion & Retraction, Multi-Material, Precision & Slicing, Custom G-code, Output options,
Notes; then an *Extruders* group), right the options of that category in titled blocks (*Generation*, *Support
geometry* …), each row: label · control (dropdown / number with stepper / toggle) · **⭐ star** (add to favourites).
Footer: **Compare** and **Save preset**. Supports are one dropdown (*Generate Supports: Manual Only*) instead of two
checkboxes. Toggles are switches, not checkboxes.

### 2.3 Printer dialog

Printer image, then *Sheet* (Satin …) and per-tool *Nozzles* (0.4 HF, 0.25, 0.6 …) as dropdowns, "Advanced settings"
button. The rest of the UI follows (filament row per tool shows the nozzle; the print preset row gets one sub-row
per tool).

### 2.4 Welcome / onboarding

A "Choose your workflow" card: **Online** (profile updates, Printables, Connect) vs **Offline** (100 % offline, manual
updates, local network printing). Chosen before any online call happens; each service can be toggled later in
Preferences. Crash reporting is opt-in here too.

## 3. Concepts behind it (not just looks)

| Concept | What changed | Relevance to WebSlicer |
|---|---|---|
| Multiple beds, different configs | One project can hold beds with different printers; no 9-bed limit | We have no multi-bed yet (TODO P3 "Multiple beds") – the data model decision matters (see §5) |
| Multiple projects | Tabs in the top bar, per-project state | We have the library + one autosaved session |
| Profile system | System profiles no longer enumerate every variant; "free parameters" (nozzle diameter, high-flow) instantiate a profile; a **ToolPrint** profile is the fourth sibling (Print/Filament/Printer/ToolPrint) for per-extruder overrides; printer = tools + feeders + sheet | Defines how vendor profiles will be shipped (JSON, see below) – affects our vendor-profile task and the CLI-upgrade plan |
| New profile format | JSON with schemas: `specs/presets/vendor-schema.json` (vendor, model, printer, tool, feeder, sheet, config templates) and `preset-schema.json` (fragments with `values`, `features`, `variants`, `inherits`, `condition`, `match_mode`) | Our `slicer/bundles.ts` reads 2.x `.ini` vendor bundles (2.9.6) – nothing to do until we move to 3.x |
| Favourites | Any option can be starred; the right panel shows the starred ones | **High value for us** – replaces our fixed quick-settings list |
| Unsaved edits in many filament presets at once | No forced save of the first modified preset | Our preset editor can learn from it |
| Colours per project | Extruder/filament colour saved in the project, not in the preset | Check how WebSlicer stores colours |
| Floating objects | Objects can be lifted above the bed | Not supported by us today |
| Plugins (Lua, sandboxed) | `plugin init`; bundles with `manifest.json`; `info` (id, type `project.plugin`, title, menu path, `params` float/int/bool) + `execute()`; first plugins: **Flow tower**, **Temperature tower** generating a ready project; marketplace + signed bundles planned | A server-side **calibration generator** (parametric dialog → project) gives users the value without a plugin system; a real plugin system is a P4 security topic |
| Offline mode | Opt-out of all online services up front | We already have `WEBSLICER_UPDATE_CHECK=off`; a Preferences switch + first-run note would match |
| Auto-restore | Background backup of all projects | Done (T-035) |
| G-code format chosen in the Save dialog | `.gcode` vs `.bgcode` per save, no global preference | Candidate small UX fix |
| Rendering | PBR-like shading, ambient occlusion, cast shadows (switchable) | Optional polish; performance risk on phones |
| Backend changes | Extrusion width now derives from nozzle diameter; 3.x projects are **not** loadable by 2.x (geometry only); CLI argument parsing rewritten; 3MF save 2× faster | **Do not follow yet** – see §4 |

## 4. What this means for the slicer engine we ship

WebSlicer drives the PrusaSlicer **CLI** (currently 2.9.6, pinned in the Dockerfile; see
`docs/PrusaSlicer-Upgrade.md`). 3.0 is a rewrite of the UI and parts of the backend, and:

- the alpha has only Prusa profiles and no SLA/G-code viewer,
- the CLI was refactored ("some parameter combinations … will require updating scripts"),
- the config and project formats changed (extrusion width semantics, 3MF compatibility is one-way).

**Recommendation:** stay on 2.9.x for the engine. Re-assess when 3.0 reaches beta *and* ships third-party profiles
*and* the CLI is documented. Then run the upgrade runbook (T-053) with the help-diff check as the first gate. Until
then, 3.0 is a **design reference only**. Worth doing early: a one-day spike that runs our `commands.ts` argument
sets against the 3.0 alpha CLI and records what breaks (no code to merge, only a table in this document).

## 5. Adoption candidates for WebSlicer

Ranking: value for users ÷ effort, respecting what already exists (left tool bar + tool panel T-046/T-055,
session restore T-035, camera views T-008, update notice T-058). IDs are new work packages; none is scheduled until
Robert decides the marked UI questions.

| ID | Candidate | From 3.0 | Effort | Decision needed from Robert |
|---|---|---|---|---|
| D-1 | **Favourite settings:** star on every option in the settings editor; the quick-settings area of the sidebar shows the starred ones (stored per user preset-independent in the data dir) | Favourites | M | Where do stars live (server data dir, per instance)? Default set? |
| D-2 | **Context-sensitive right panel:** one panel that shows printer/filament/print summary when nothing or the plate is selected, the object's settings when an object is selected, the tool controls when a tool is open; destination + big **Slice → Send** at the bottom | Right panel | L | Keep tools on the left (current) or move tool panels to the right like Prusa? Recommendation: keep left (does not hide the object), put object settings right |
| D-3 | **Object list as overview** (beds/objects, SLICED badge, thumbnails, collapsible) and object settings moved out of it | Object list | M | Do we want printer groups now or only beds later? |
| D-4 | **Settings dialog redesign:** category rail with icons, toggles instead of checkboxes, star column, *Compare* and *Save preset* in the footer, supports as one dropdown | Settings dialog | M–L | Visual direction for the whole app (see D-9) |
| D-5 | **Preview cards:** *Sliced info* (material, time), *Legend* with scheme drop-down and *Detail view*; G-code line viewer synced to sliders; *Auto-reslice* toggle | Preview | M | G-code text window already on TODO P3 – pull it forward? |
| D-6 | **View cube** + selectable mouse schemes (also helps touch work on the mobile track) | View cube, camera bindings | S–M | Which schemes (suggest: ours, Blender, Fusion)? |
| D-7 | **Calibration generators** (flow tower, temperature tower, later retraction/speed/PA): parametric dialog → generated project, server-side, validated by the existing config limits | Lua calibration plugins | M | Which towers first? |
| D-8 | **Offline/online first-run card** and a Preferences section "Online services" (update check, later profile updates), crash reporting stays absent | Welcome wizard | S | Wording; show once on first start? |
| D-9 | **Theme:** light and dark with one token set, orange accent for primary action, consistent cards | Light/dark | M | Dark default? Accent colour? (Current app styling to be checked before any task) |
| D-10 | **Project tabs** in the top bar (several plates open, per-tab undo and tool state) | Multiple projects | L | Overlaps with Library + autosave design; decide after mobile |
| D-11 | **Multiple beds** with their own printer/preset; bed rows in the object list | Multiple beds | L | Data model first: *project → beds → objects*, each bed with a printer preset reference (design note before any code) |
| D-12 | **Per-project colours**, **floating objects**, **G-code format chosen when saving**, **remember last destination** | Smaller items | S each | – |
| D-13 | **Unsaved edits in several presets at once** in the preset editor | Profiles | S–M | – |
| D-14 | **Profile filter by filament type + fuzzy search**, global search field in the top bar | Search | M | Global search already on TODO P3 |

Not adopted: Connect/Printables/Prusa-account integration (we are self-hosted), Sentry crash reporting, Lua
plugin runtime (P4, needs a sandbox review), PBR/AO rendering (revisit after the mobile preview work), 3Dconnexion.

## 6. Suggested order (proposal, for Robert)

1. **Now, no UI decision needed:** D-12 small items, D-13, D-8 (cheap, additive).
2. **After T-059 and the vendor-profile/wizard tasks (P2):** D-1 favourites → D-5 preview cards → D-6 view cube &
   camera schemes → D-7 calibration generators.
3. **With the mobile track (P3):** D-9 theme tokens and D-2/D-3 layout work together with M-1 breakpoints – the
   right-panel/bottom-sheet question is the same question.
4. **Later:** D-10 tabs, D-11 multiple beds, D-4 settings redesign (needs D-1 and D-9 first).

## 7. Open questions for Robert

1. Do you want WebSlicer to follow the 3.0 layout (rail + object list left, context panel right), or keep our own
   tool-left layout and only take the individual ideas (D-1, D-5, D-6, D-7)?
2. Dark theme as default? Keep our colours or move to a Prusa-like orange accent?
3. Is a 3.0 CLI spike (§4) worth a day now, or wait for a beta?
4. D-11 (multiple beds with different printers) – wanted at all, or one printer per project is enough?
