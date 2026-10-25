# Layout draft – rail + object list on the left, context panel on the right

Status: **draft for Robert's review** (2026-10-24). Direction decided by Robert: follow the PrusaSlicer 3.0
layout (see `docs/research/PrusaSlicer-3.0-UI.md`, §2). This document turns that into a plan that can be built in
small, independently shippable steps without breaking the E2E suite. Nothing here is scheduled until Robert
approves the open decisions in §8.

## 1. Where we are today

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ TopBar: [Plater|Preview|Print|Filament|Printer]  Import  Library  Export▾  Printers  Mode  ⓘ  update-chip │
├───┬──────────────────────────────────────────────────────────────┬────────────────┤
│ T │                                                              │ Sidebar (340px)│
│ o │                      3D view (Viewer)                        │  3 preset      │
│ o │   [tool panel docked next to the bar when a tool is open]    │  selects       │
│ l │                                                              │  quick settings│
│ s │                                                              │  Objects list  │
│   │                                                              │  (+ per-object │
│ b │                                                              │  settings,     │
│ a │                                                              │  manipulation) │
│ r │                                                              │  Slice panel   │
└───┴──────────────────────────────────────────────────────────────┴────────────────┘
```

Facts that shape the plan (checked in the code):

- `App.tsx`: `TopBar` + `main` = either `SettingsView` (view = print/filament/printer, full page) or
  `DropZone(Viewer)` + `Sidebar`.
- `Sidebar.tsx`: presets → `QuickSettings` → (`ObjectsSection` | `SimpleObjects`) + `SlicePanel`, or `PreviewPanel` in the
  preview view. The object list carries object settings, volumes, ranges and manipulation – the "misused list" Prusa
  moved away from.
- Tools: registry (`web/src/tools/registry.ts`) → `ToolBar` (left, labels on wide screens) + `ToolDock` (panel next to
  the bar) with `ToolPanel` frame and `fields/` blocks (T-046/T-055).
- Mode switch simple / advanced / expert already hides parts of the sidebar.
- Styling: CSS custom properties in `styles.css` (`--bg`, `--accent: #ed6b21` orange …), one CSS file per component,
  breakpoints only at 1100 px and 640 px in `TopBar.css`.
- The E2E specs (`e2e/specs/*.spec.ts`, 117 tests) select by class names and text; `sidebar.spec.ts` guards the sidebar.

## 2. Target layout (wide screen ≥ 1280 px)

```
┌────┬───────────────────────────────────────────────────────────────────────────────────┐
│    │ ☰ Menu  File  💾  ↶ ↷ ▾  ▤(hide panels)     [ Project ]                    🔍 Search │
│ R  ├────────────────┬────────────────────────────────────────────────────┬────────────┤
│ A  │ OBJECT LIST  ⌃ │ [Prepare | Preview]   (tool strip, floating)       │ CONTEXT    │
│ I  │ Printer: MK4   │ ┌──────────────────────────────────────────────┐   │ PANEL      │
│ L  │  Bed 1         │ │ [add][arrange] │ move rotate scale … cut …   │   │            │
│    │   ▸ cube.stl   │ └──────────────────────────────────────────────┘   │ plate:     │
│ ▣  │   ▸ part.stl   │                                                    │  printer / │
│ S  │                │                    3D scene                        │  filament /│
│ L  │ ─ Preview only │                                                    │  print,    │
│ I  │ Sliced info    │                                                    │  favourites│
│ C  │ Legend         │ ◲ view cube                                        │ object:    │
│ E  │                │                                                    │  its       │
│ 🗂 │                │                                                    │  settings  │
│ L  │                │                                                    │ tool:      │
│ I  │                │                                                    │  controls  │
│ B  │                │                                                    ├────────────┤
│ 🖶 │                │                                                    │ Destination│
│ P  │                │                                                    │ [  Slice  ]│
│ ⚙ ⓘ│                │                                                    │            │
└────┴────────────────┴────────────────────────────────────────────────────┴────────────┘
```

### 2.1 Regions and what lives in them

| Region                                             | Content                                                                                                                                                                                                    | Today's component(s)                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rail** (64 px, icon + label)                     | _Slicing_ (the plater and the preview), _Library_, _Printers_; bottom: _Preferences_ (the application preferences), _About/Update chip_                                                                    | `Rail` (rendered from `nav/navMap.ts`)                                                                                         | As built in L-1 and L-3: Library, Printers, Preferences and About are dialogs. The settings views _Print/Filament/Printer_ are **not** on the rail; they open from the preset rows' settings buttons and (since the settings-discoverability pass) from **Menu → Settings**. That pair is the one stated exception to "one home" in the navigation map. |
| **Top bar** (slim)                                 | Menu (**Import models…**, **Import presets…**, **Settings ▸**, **Export ▸**), undo/redo, hide-panels toggle, project name (single tab now)                                                                 | `AppMenu`, `TopBar`                                                                                                            | As built in L-3 and L-4: the mode moved to **Preferences**, the Library/Printers/About dialogs to the rail, save-project/G-code into the Export submenu, the settings views to the preset rows and the _Prepare / Preview_ switch to the tool strip – one home per function, checked by `navigation.spec.ts`.                                           |
| **Object list** (left, collapsible card)           | Printer group → bed → objects with thumbnail, SLICED badge, instance count; selection; add/arrange stay on the tool strip. In _Preview_ the same column also shows **Sliced info** and **Legend**          | `ObjectsSection` (list part only), `SimpleObjects`, `SlicedInfo`, `Legend`                                                     | Object **settings, volumes, ranges and manipulation leave the list** and move to the context panel (object mode)                                                                                                                                                                                                                                        |
| **Tool strip** (floating, top centre of the scene) | Prepare/Preview switch; delete, add/remove instance, arrange and its settings; the registry's tools as icons; names as tooltips, and as text when the strip has room; **⋯** for the groups that do not fit | `ToolStrip` (+ registry, `stripLayout`)                                                                                        | **Built in L-4**: it moved from the left edge to the top because the left side now holds rail + list. Registry stays the single source                                                                                                                                                                                                                  |
| **Context panel** (right, 340 px)                  | Four modes, see §3                                                                                                                                                                                         | `ContextPanel` decides the mode; `ToolMode` + `ToolPanel` + `ToolHints` for the open tool, `PreviewPanel` pieces, `SlicePanel` | One component `ContextPanel` decides the mode; the destination + **Slice/Send** footer is shared and always at the bottom                                                                                                                                                                                                                               |
| **Scene overlays**                                 | View cube (bottom-left), update chip moves to the rail; the view toolbar and the reset view button sit below the strip's band                                                                              | `three/`                                                                                                                       | View cube is a separate item (D-6). **L-4:** the centred pill reaches both top corners on a narrow scene, so the view toolbar starts 52 px down – visible but unclickable was the bug the `camera` spec caught                                                                                                                                          |

### 2.2 Context modes (what the right panel shows)

The mode is derived from state, never stored: `tool open` > `preview` > `object selected` > `plate`.

| Mode                         | Header                                | Body                                                                                                                                                      | Footer                                                                                 |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Plate** (nothing selected) | Printer card (name, bed size, nozzle) | Print/filament preset selects (+ ⚙ opens the full settings view), **favourite/quick settings** (D-1 later; today's `QuickSettings`), supports/brim groups | Destination + **Slice**                                                                |
| **Object**                   | Object name, instance count           | Manipulation (position/rotation/scale/size), per-object settings overrides, volumes (parts, modifiers), layer-range list, mirror/split/merge entry points | Destination + **Slice**                                                                |
| **Tool**                     | Tool title + ✕ (Esc)                  | The tool's controls (cut, paint, place on face, layer height) – the existing `ToolPanel` frame content, rendered in the panel instead of next to the bar  | Tool's own primary action sticky at the bottom (as T-046 defined), otherwise unchanged |
| **Preview**                  | G-code viewer title                   | View options (feature colours, scheme), layer/move slider values, preflight/send gate summary, G-code lines (later)                                       | Destination + **Send**                                                                 |

Simple mode shows the same four modes with fewer blocks (as today: no list internals, no ranges/modifiers).

## 3. State model

- No new global store for layout. Add a small `layout` slice: `leftOpen`, `rightOpen`, `leftCollapsedSections`
  (persisted in `localStorage`, wrapped in try/catch), plus the derived selector `contextMode(state)`.
- `view` keeps meaning _plater | preview | print | filament | printer_; the settings views stay full-page for now (the
  settings dialog redesign is D-4, later).
- The selection model, tool registry and history are untouched.

## 4. Responsive behaviour (aligned with the mobile track M-1…M-5)

| Width               | Layout                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ≥ 1280 px           | as §2                                                                                                                                                  |
| 900–1279 px         | list auto-collapses to a thin column (icons + thumbnails); context panel 300 px; tool strip loses text labels                                          |
| 640–899 px (tablet) | rail becomes icons only; list and context panel are **drawers** toggled from the top bar; opening a tool shows its controls as a **bottom sheet**      |
| < 640 px (phone)    | rail becomes a **bottom tab bar** (Slicing, Library, Printers, More); context panel = bottom sheet with the Slice button always visible; list = drawer |

The context-panel _content_ is the same everywhere; only the container changes. That is why §2.2 is defined by mode, not
by position.

## 5. Visual language (kept small)

Reuse the existing tokens (dark default, orange accent `--accent` for the primary action, active tool and selection
outline; blue-grey for selected rows). Cards with 8 px radius and 12 px padding, switches instead of checkboxes in new
code, 4/8/12/16 spacing scale. A full light/dark token pass is D-9 and is **not** a prerequisite: new components use
tokens only (no literal colours) so D-9 stays a find-and-replace.

## 6. Migration plan (each step ships alone, E2E green)

The risk is the 117 E2E tests, which select by class name. So the first step makes the layout _movable_.

| Step                            | Content                                                                                                                                                                                                                                                    | Size | E2E impact                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| **L-0 Stable hooks**            | Add `data-testid` / region landmarks (`rail`, `object-list`, `context-panel`, `tool-strip`, `slice-button`, …) to the current components and switch the specs that depend on structure (sidebar, send, dialogs, preview, viewer) to them. No visual change | M    | Mechanical; this is the safety net for everything below                            |
| **L-1 Shell + rail**            | New `AppShell` grid (rail, left, scene, right); rail with Slicing/Library/Printers/Preferences/About; top bar slimmed (menu, undo/redo, hide-panels); update chip moves to the rail                                                                        | M    | Locators from L-0 keep working; specs that click `Library`/`Printers` use the rail |
| **L-2 Object list as overview** | Left column with the bed/object list, selection, instance counts, collapse; Preview cards (Sliced info, Legend) move here; object rows lose their inline settings                                                                                          | M–L  | `sidebar.spec.ts` object-row tests adapt                                           |
| **L-3 Context panel**           | `ContextPanel` with plate and object modes; manipulation/settings/volumes/ranges move in; shared Slice/destination footer; old `Sidebar` deleted                                                                                                           | L    | Biggest move; split plate/object across two hand-backs if needed                   |
| **L-4 Tool strip + tool mode**  | Tool bar becomes the top-centre strip; tool panels render in the context panel (mode _tool_); Prepare/Preview switch joins the strip                                                                                                                       | M    | `tools`, `cut`, `layer-profile`, `camera` specs adapt through L-0 hooks            |
| **L-5 Preview mode**            | Preview controls into the context panel, sliders unchanged on the scene                                                                                                                                                                                    | M    | `preview` spec                                                                     |
| **L-6 Responsive**              | The §4 table; drawers, bottom sheet, bottom tab bar (shared with M-1/M-2)                                                                                                                                                                                  | L    | New viewport projects in Playwright (phone, tablet)                                |

Order: L-0 → L-1 → L-2 → L-3 → L-4 → L-5, then L-6 together with the mobile track. D-1 (favourites), D-6 (view cube),
D-5 (preview cards) slot in after L-3/L-5 because they need the new panels.

## 7. Risks and how the plan handles them

| Risk                                     | Handling                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| E2E suite breaks on every move           | L-0 first; one structural step per task; touched specs run locally, full suite in CI                                      |
| Users lose features while things move    | Every old control gets an explicit new home in §2.1/§2.2 (checklist in each task); `docs/features.md` stays the inventory |
| Tool strip hides tools on narrow screens | Overflow "⋯" menu from the registry's `group` field                                                                       |
| Three.js canvas resizes with the panels  | One resize observer on the scene container (exists in `useScene`); verify in L-1                                          |
| CSS growth                               | Keep one CSS file per component, tokens only, no new global rules                                                         |
| Mobile gets a second rewrite             | §4 decided now; L-1/L-3 build containers that L-6 only re-skins                                                           |

## 8. Decisions for Robert (with recommendation)

1. **Tool strip placement.** Prusa puts it top-centre over the scene. Recommendation: **top-centre strip** (icons +
   tooltips, text when wide). Alternative: keep a vertical tool bar inside the scene's left edge (costs scene width,
   keeps T-055's labels).
2. **Rail contents.** Recommendation: _Slicing, Library, Printers_, bottom _Preferences, About_. Anything else
   (Calibration later)?
3. **Settings views (Print/Filament/Printer)** stay full-page for now and open from the settings button next to a preset and from **Menu → Settings**;
   redesign (modal with category rail, favourites star, Compare/Save) is a separate step after L-3 (D-4). OK?
4. **Printer groups in the list.** Today one printer per project. Recommendation: build the list as _printer → bed →
   objects_ but show only one printer and one bed; real multi-bed (D-11) comes later without a rewrite.
5. **Order vs. current P2 work.** Recommendation: finish the running P2 tasks (T-060 vendor profiles, wizard
   extension) and start **L-0** right after; L-1…L-5 then replace the mobile task M-1 as the first P3 step.

### Decided by Robert, 2026-10-24

1. Tool strip: **top centre** of the scene (icons + tooltips, text when wide).
2. Rail: **Slicing, Library, Printers**; bottom **Preferences, About**.
3. Order: layout rebuild **directly after the icon system** (T-063); it replaces M-1 as the first P3 step. Decisions 3 and 4 stay as recommended (settings views full-page for now; printer groups prepared, one printer shown).

### Visual proposal (2026-10-24)

After Robert's review of the first implementation ("far from good UX"), the visual direction is `docs/design/mockup-layout.html` (three states, open in a browser) with PNGs in
`docs/design/mockup/` (plate, object, preview): floating cards over a full-width scene, a compact tool strip, Prepare/Preview in the top bar, grouped rows with 32 px controls, icon
buttons instead of text-button walls, one accent colour. Robert approved it (2026-10-24), and it became T-070.

### Implemented (T-070, round (a), 2026-10-24)

The shell and the visual language are in place; the panel content and the preview mode follow in round (b).

- **The frame** is `rail | bar / rail | scene`: the rail runs the full height, the 48 px bar starts beside it, and the scene takes everything right of the rail below the bar. The
  object list and the context panel are no longer grid tracks; they are absolutely positioned cards over the scene, so folding a card or hiding the panels leaves the canvas at its
  place and size. `--card-gap`, `--panel-w` (344 unset, 300 below 1280) and `--list-w` (the `layout` slice's width, 276 by default, 148 folded, 0 hidden and on a phone) are the
  frame's measurements; the cards, the strip's band and the scene overlays all read them. The panel and its footer are one flex column (`.context-stack`), so the footer's own
  height sets where the panel ends – a fixed `--foot-h` guess would overlap them as soon as the footer grows (a slice result, a plate warning).
- **Tokens** are the mockup's set in `styles.css` (`--rail --bar --card --card-2 --line --field --field-h --text --muted --faint --accent --accent-h --sel --r --h` plus
  `--bg --edge --shadow`); the older names are aliased onto them, so untouched components keep working while new ones use the mockup's names only. Control height 32 px, card radius
  10 px, 12 px card padding, 34 px icon buttons.
- **Top bar**: Menu, undo/redo, hide-panels, project name with its save state, the **Prepare | Preview** segmented switch centred in the bar and the update chip at the right edge.
  The switch left the tool strip; `VIEW_SWITCH_ENTRIES` keeps its one home in the navigation map.
- **Rail**: 52 × 56 tiles with the icon above an 11 px name, the current place filled with the accent colour; the update chip moved from the rail to the top bar.
- **Object list card**: the card's own header carries the title, the count and the fold chevron; the width grip still drags it (220–420 px). It starts folded below 1280 px and is a
  drawer below 900 px.
- **Context panel**: the panel card and a separate footer card (Destination + Slice) below it, both in one flex column at the scene's right edge; the footer's own height keeps
  them from overlapping, whichever warnings or slice result it carries.
- **Tool strip**: the pill is centred in the band the two cards leave free (the band is a measured
  layer between the cards, observed with a `ResizeObserver`), 34 px buttons, accent tool, 7 px
  dividers and the overflow menu; the switch is gone from it.
- **Responsive**: ≥ 1280 px as the mockup; 900–1279 px the panel is 300 px and the list starts folded; below 900 px the list is a drawer and the strip scrolls; below 640 px the rail
  is a bottom tab bar and the cards are sheets.

### Implemented (T-070, round (b), 2026-10-25) – panel content and preview mode (L-5)

The content of the three modes follows the mockup; the shared building blocks are `PanelCard` (a titled card with an optional control in its
heading), `PanelRow` (label left, control right), `GroupTitle` (the 11 px uppercase group rule) and `Switch`.

- **Plate mode**: `PlateMode` is the **Printer & material** card – printer tile, preset name, nozzle/bed/height summary, the loaded filament with its colour dot, name and
  nozzle. `Presets` is the **Print settings** card: the print preset select with `PresetCog` in the heading, the filament and printer rows and the two visibility
  switches, then `QuickSettings` regrouped into **Walls & perimeters**, **Infill** and **Supports & adhesion** as `PanelRow`s (the brim is a `Switch`). The
  quick rows write the same `setOption` as the settings view, so nothing is reachable only there.
- **Object mode**: `ObjectHeader` is the header card (thumbnail tile, name, "n instance(s) · size", the ✎ rename that writes `renameObject` directly).
  `TransformInputs` draws the axis-coloured X/Y/Z headers and keeps the unit inside each 30 px field; `TransformCard` keeps the instances stepper with
  **Fill bed**, then one `.object-actions` row of 34 px icon buttons from `table.ts` (`mirrorX/Y/Z`, `resetRotation`, `resetScale`, `reset`, `lock/unlockProportions`,
  `splitToObjects`, `splitToParts`, `addInstance`), the proportions lock as state on the card. `SettingsCard` is a `PanelRow` with an **Edit…** button and the
  override count, `PartsCard` rows carry the volume-type icon (`VOLUME_ICON_NAMES`) and a delete action. Only icons of `table.ts` are used.
- **Left card**: `ObjectRow` is a thumbnail tile with the name and the size/instances line above the instance list; the empty list keeps the library link and
  adds **Add objects…**, which calls the menu's file input through `importTrigger` (not a second `navMap` entry).
- **Preview mode (L-5)**: the **Sliced info** card (`PanelRow`s, the `SLICED` badge through `SideCard`'s new `aside`) and the **Legend** card (the scheme
  drop-down in the heading) stay in the left card; the right panel is **View** (`ViewOptions`: the scheme select plus the "Show" rows with a swatch and a
  `Switch` each), **G-code check** (`Preflight`) and **Layer** (`layer-summary`, both sliders with value badges, the codes, the move slider). The footer card
  swaps `SlicePanel` for `PreviewFooter` (**Send to printer**, export, save to library) and keeps `Destination`. The sliders keep their store logic and are
  restyled only. The old → new table is in `.ai/reports/T-070.md`.
