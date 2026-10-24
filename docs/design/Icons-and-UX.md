# UX and icon concept – follow PrusaSlicer 3.0 where it fits

Status: **draft for Robert's review** (2026-10-24). Companion to `docs/design/Layout-3.0.md`.
Robert's rules: (1) **UX first**; (2) icons must be _meaningful and consistent_ – one function, one icon, everywhere;
(3) take Prusa's concept over as designed, but **only for functions we actually have or plan** – no dead buttons, no
icons for features without an API; adapt where our product differs.
Visual overview of every icon below: **`docs/design/icon-sheet.html`** (open it in a browser).

## 1. How Prusa does it (read from their code)

- **One central table per tool.** `ToolGizmosUiInfo.cpp` holds, for each tool, _name_, _shortcut_ and _icon_. The tool
  strip, the context menus and the dialog titles all take the icon from that table, so Move looks the same everywhere.
  WebSlicer's registry (`web/src/tools/registry.ts`) is already built the same way (T-046), and our shortcuts already
  agree with theirs (M R S F C L P V).
- **Tool strip order:** Add… | Delete selection, Add instance | Move, Rotate, Scale, Place on face, Arrange,
  Simplify | Paint supports, seams, fuzzy skin, multimaterial | Text, SVG | Cut, Measure | Variable layer height,
  Height range | the **Prepare / Preview** switch. Grouping: editing → painting → creation → cut/measure → layers.
- **Names and keys in tooltips** ("Move (M)"); disabled tools explain _why_ they are disabled.
- **Icons carry meaning inside lists:** object, part (union), negative volume (subtract), modifier (exclude), support
  blocker / enforcer, instances, "overridden settings" marker, painted-supports / seam / multimaterial markers,
  sinking, lock closed/open for "same as system preset / differs". The list is readable without text.
- **Icons in the preview legend** for every move type (travel, wipe, retract, deretract, seams, tool/colour changes,
  pauses, custom G-code, shells, tool marker).
- **Key-hint rows in tool panels:** mouse buttons / wheel / drag icons and key chips (`SHIFT +`, `ALT +`, `X`) next to a
  one-line action ("Remove painted colour", "Swap colours", "Tool size"), so nobody has to read a manual.
- **Colour language:** one accent (orange) for the primary action, the active tool and selection outlines; blue-grey
  for selected rows; red/yellow only for errors/warnings; the dark and the light theme use the same icon set.
- **Switches instead of checkboxes**, star = favourite, undo arrow = revert one option, cog = open the full settings.

## 2. Where the icons come from

PrusaSlicer's `resources/icons/` holds 440 SVGs, shipped in the AGPL-3.0 repository – the same licence as WebSlicer,
so reuse with attribution is allowed. The product logo and the cloud entries (`PrusaSlicer*.svg`, `printables`,
`connect`) are **never** used. The artwork has a fixed light-grey fill (`#F7F7F7`) made for their dark theme.

**Recommendation:** use the Prusa SVG wherever the function appears in the map below ("we have it" or "on our
roadmap"); keep lucide only for generic chrome that Prusa has no icon for (chevrons, close, menus) and for functions
without a Prusa counterpart (for example "rename preset"). Both sources go through **one table** (like today's
`ACTION_ICONS`, named by function, not by picture), so a swap never touches the components.

How (task I-1, no new dependency):

- `scripts/vendor-icons.mjs` (run by a developer, not at build time) copies a fixed list of SVGs from
  `prusa3d/PrusaSlicer` at a **pinned commit**, normalises them (`fill` → `currentColor`, drop the fixed width/height,
  keep the `viewBox`) and writes `web/src/icons/prusa/<name>.svg` plus a generated `index.ts`.
- `<Icon name="move" />` renders the inline SVG (`aria-hidden`; the label comes from the control), sized by CSS tokens.
- `THIRD_PARTY_NOTICES.md` gets the entry (source, commit, licence); a unit test fails if a used name is missing.
- The icon sheet is regenerated from the same list, so the map and the app cannot drift apart.

## 3. Icon map (the same list the sheet is generated from)

| Group          | Function                            | Prusa icon (`resources/icons/…`) | Key    | Status         | WebSlicer today                                        |
| -------------- | ----------------------------------- | -------------------------------- | ------ | -------------- | ------------------------------------------------------ |
| Tool strip     | Add object / import                 | `add_object.svg`                 | –      | we have it     | Upload button in the top bar (text)                    |
| Tool strip     | Delete selection                    | `delete_button.svg`              | Del    | we have it     | Trash2                                                 |
| Tool strip     | Add instance                        | `rectangle_add.svg`              | +      | we have it     | Plus                                                   |
| Tool strip     | Move                                | `move.svg`                       | M      | we have it     | Move                                                   |
| Tool strip     | Rotate                              | `rotate.svg`                     | R      | we have it     | RotateCw                                               |
| Tool strip     | Scale                               | `scale.svg`                      | S      | we have it     | Scaling                                                |
| Tool strip     | Place on face                       | `place.svg`                      | F      | we have it     | PanelBottom                                            |
| Tool strip     | Arrange                             | `layout.svg`                     | Q      | we have it     | LayoutGrid (our key: Shift+A)                          |
| Tool strip     | Paint-on supports                   | `paint_supports.svg`             | L      | we have it     | Paintbrush                                             |
| Tool strip     | Paint-on seams                      | `paint_seams.svg`                | P      | we have it     | Spline                                                 |
| Tool strip     | Multimaterial painting              | `paint_multi_material.svg`       | N      | we have it     | Palette (no key yet)                                   |
| Tool strip     | Cut                                 | `cut.svg`                        | C      | we have it     | Scissors                                               |
| Tool strip     | Variable layer height               | `variable_layer_height.svg`      | V      | we have it     | Layers3                                                |
| Tool strip     | Height range (layer range settings) | `height_range.svg`               | W      | on our roadmap | list rows today; becomes a tool with the context panel |
| Tool strip     | Simplify                            | `simplify.svg`                   | E      | on our roadmap | TODO P3                                                |
| Tool strip     | Measure                             | `ruler.svg`                      | U      | on our roadmap | TODO P3                                                |
| Tool strip     | Emboss text                         | `text.svg`                       | T      | on our roadmap | TODO P3 (text/SVG embossing)                           |
| Tool strip     | Paint-on fuzzy skin                 | `paint_fuzzy_skin.svg`           | H      | not planned    | not planned                                            |
| Top bar        | Undo                                | `tb_undo.svg`                    | Ctrl+Z | we have it     | Undo2                                                  |
| Top bar        | Redo                                | `tb_redo.svg`                    | Ctrl+Y | we have it     | Redo2                                                  |
| Top bar        | Open / load project                 | `tb_load.svg`                    | Ctrl+O | we have it     | text button                                            |
| Top bar        | Save project                        | `tb_save.svg`                    | Ctrl+S | we have it     | Save                                                   |
| Top bar        | Hide / show side panels             | `tb_show_ui.svg`                 | –      | on our roadmap | layout draft (hide panels)                             |
| Top bar        | Search                              | `search_gray.svg`                | Ctrl+F | on our roadmap | global search, TODO P3                                 |
| Top bar        | New project tab                     | `plus_new.svg`                   | –      | on our roadmap | project tabs (D-10)                                    |
| Mode           | Simple mode                         | `mode_simple.svg`                | –      | we have it     | select box                                             |
| Mode           | Advanced mode                       | `mode_advanced.svg`              | –      | we have it     | select box                                             |
| Mode           | Expert mode                         | `mode_expert.svg`                | –      | we have it     | select box                                             |
| Object list    | Object                              | `object_icon.svg`                | –      | we have it     | none                                                   |
| Object list    | Part (solid volume)                 | `union.svg`                      | –      | we have it     | none                                                   |
| Object list    | Negative volume                     | `subtract.svg`                   | –      | we have it     | none                                                   |
| Object list    | Modifier                            | `exclude.svg`                    | –      | we have it     | none                                                   |
| Object list    | Support blocker                     | `support_blocker.svg`            | –      | we have it     | none                                                   |
| Object list    | Support enforcer                    | `support_enforcer.svg`           | –      | we have it     | none                                                   |
| Object list    | Instances                           | `instances_icon.svg`             | –      | we have it     | none                                                   |
| Object list    | Overridden settings marker          | `overrides_marker.svg`           | –      | we have it     | none                                                   |
| Object list    | Custom supports painted             | `fdm_supports.svg`               | –      | we have it     | none                                                   |
| Object list    | Custom seam painted                 | `seam_.svg`                      | –      | we have it     | none                                                   |
| Object list    | Multimaterial painted               | `mmu_segmentation_.svg`          | –      | we have it     | none                                                   |
| Object list    | Sinking object                      | `sinking.svg`                    | –      | on our roadmap | floating/sinking objects (D-12)                        |
| Object list    | Add bed                             | `add_bed.svg`                    | –      | on our roadmap | multiple beds (D-11)                                   |
| Object list    | Delete bed                          | `del_bed.svg`                    | –      | on our roadmap | multiple beds (D-11)                                   |
| Object list    | Not printed (eye)                   | `dont_print.svg`                 | –      | not planned    | no feature                                             |
| Settings       | Open settings (cog)                 | `cog.svg`                        | –      | we have it     | Settings                                               |
| Settings       | Favourite star                      | `star.svg`                       | –      | on our roadmap | favourites (D-1)                                       |
| Settings       | Favourite star (set)                | `star_solid.svg`                 | –      | on our roadmap | favourites (D-1)                                       |
| Settings       | Compare presets                     | `compare.svg`                    | –      | on our roadmap | TODO P3                                                |
| Settings       | Revert to preset value              | `undo_r.svg`                     | –      | we have it     | RotateCcw                                              |
| Settings       | Lock (value equals system preset)   | `lock_closed.svg`                | –      | we have it     | none                                                   |
| Settings       | Unlocked (value differs)            | `lock_open.svg`                  | –      | we have it     | none                                                   |
| Presets        | Printer                             | `printer.svg`                    | –      | we have it     | none                                                   |
| Presets        | Physical printer                    | `printer_physical.svg`           | –      | we have it     | none                                                   |
| Presets        | Filament                            | `spool.svg`                      | –      | we have it     | none                                                   |
| Presets        | Print settings                      | `cog.svg`                        | –      | we have it     | none                                                   |
| Presets        | Printer online / busy / offline     | `printer_available.svg`          | –      | on our roadmap | printer status, deferred until hardware beta           |
| Presets        | Printer offline                     | `printer_offline.svg`            | –      | on our roadmap | printer status, deferred                               |
| Export         | Export G-code                       | `export_gcode.svg`               | Ctrl+G | we have it     | text button                                            |
| Export         | Save G-code to local file           | `save_print_to_local.svg`        | –      | we have it     | text button                                            |
| Export         | Send to printer host                | `connect_gcode.svg`              | –      | we have it     | text button                                            |
| Export         | Export config                       | `export_config.svg`              | –      | we have it     | text menu                                              |
| Export         | Export config bundle                | `export_config_bundle.svg`       | –      | we have it     | T-059                                                  |
| Export         | Import config                       | `import_config.svg`              | –      | we have it     | text menu                                              |
| Export         | Import config bundle                | `import_config_bundle.svg`       | –      | we have it     | T-059                                                  |
| Preview legend | Travel                              | `legend_travel.svg`              | –      | we have it     | colour swatch                                          |
| Preview legend | Wipe                                | `legend_wipe.svg`                | –      | we have it     | colour swatch                                          |
| Preview legend | Retractions                         | `legend_retract.svg`             | –      | we have it     | colour swatch                                          |
| Preview legend | Deretractions                       | `legend_deretract.svg`           | –      | we have it     | colour swatch                                          |
| Preview legend | Seams                               | `legend_seams.svg`               | –      | we have it     | colour swatch                                          |
| Preview legend | Tool changes                        | `legend_toolchanges.svg`         | –      | we have it     | colour swatch                                          |
| Preview legend | Colour changes                      | `legend_colorchanges.svg`        | –      | we have it     | colour swatch                                          |
| Preview legend | Pauses                              | `legend_pauseprints.svg`         | –      | we have it     | colour swatch                                          |
| Preview legend | Custom G-codes                      | `legend_customgcodes.svg`        | –      | we have it     | colour swatch                                          |
| Preview legend | Shells                              | `legend_shells.svg`              | –      | we have it     | colour swatch                                          |
| Preview legend | Tool marker                         | `legend_toolmarker.svg`          | –      | we have it     | colour swatch                                          |
| Hints          | Mouse left / right / wheel / drag   | `mouse_left.svg`                 | –      | we have it     | text                                                   |
| Hints          | Mouse right                         | `mouse_right.svg`                | –      | we have it     | text                                                   |
| Hints          | Mouse wheel                         | `mouse_wheel.svg`                | –      | we have it     | text                                                   |
| Hints          | Mouse drag                          | `mouse_drag.svg`                 | –      | we have it     | text                                                   |
| Notifications  | Warning                             | `notification_warning.svg`       | –      | we have it     | text/colour                                            |
| Notifications  | Error                               | `notification_error.svg`         | –      | we have it     | text/colour                                            |
| Notifications  | Info                                | `notification_info.svg`          | –      | we have it     | text/colour                                            |
| Notifications  | Close                               | `notification_close.svg`         | –      | we have it     | X                                                      |

Legend: _we have it_ → swap now (I-1/I-2); _on our roadmap_ → the icon is vendored but not shown until the feature
ships; _not planned_ → the icon is not vendored.

## 4. UX rules we copy (checklist for every UI task)

1. **One function = one icon**, taken from the table – the same picture in the tool strip, the object list row, the
   menu and the shortcut list.
2. **Tooltip = "Name (Key)"**; disabled controls say why ("Cut (C): remove modifiers and parts first" – already done in T-046).
3. **Active tool = accent colour**, everything else neutral; only one accent on screen for "the thing to press".
4. **Lists are readable without text:** volume type, instance count, painted markers, "overridden" marker – icons first,
   names second.
5. **Tool panels end with a key-hint block** (mouse/keys + one-line effect), built from the registry, not hand-written.
6. **Switches for on/off, steppers for numbers with units**, a revert arrow per changed value, a lock icon for "equals
   system preset".
7. **The primary action sits at the bottom of the context panel** (Slice → Send), always visible, never a second
   competing accent.
8. **Notifications = icon + one sentence + close**; severity by icon and colour, not by text alone.
9. **Empty and disabled states explain the next step** instead of hiding the control.
10. **Touch:** every icon button has a ≥ 40 px hit area (mobile track); information that appears on hover is also
    reachable by tap or long press.

## 5. What we deliberately do not take

Connect / Printables / Prusa-account entries, cloud icons, fuzzy-skin painting, the "not printed" eye toggle, SLA
icons. Icons for text embossing, measure and simplify are vendored only when those features ship. Prusa's printer
picture cards come with Prusa's printer assets and stay out unless a vendor bundle brings its own pictures (it does:
`bed_texture`, thumbnails).

## 6. Proposed tasks

| ID  | Content                                                                                                                                                                          | Notes                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| I-0 | **Robert reviews `icon-sheet.html`** and strikes or swaps icons he dislikes                                                                                                      | before any code                                      |
| I-1 | Icon system: vendoring script, `<Icon>`, one icon table; migrate the tool strip, top bar and object toolbar to the Prusa icons; notices; tests                                   | M; can run before L-0 (a pure swap behind the table) |
| I-2 | Icon pass 2: object-list row icons (part/negative/modifier/blocker/enforcer, instances, overridden, painted markers), mode icons, preview legend icons, lock/revert/star markers | M; fits with L-2 (object list) and L-5 (preview)     |
| I-3 | Key-hint block in tool panels, generated from the registry (mouse icons + key chips)                                                                                             | S–M; with L-4                                        |
| I-4 | Tooltip and disabled-reason pass over all icon buttons (checklist in §4)                                                                                                         | S                                                    |

Order: I-0 → I-1 soon (cheap, visible, no layout dependency) → I-2/I-3 together with the layout steps they belong to.
