# Work package Q8 – React Compiler prep, docs diet, CSS split

|            |                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q8-housekeeping` (branch `feature/q8-housekeeping`)                                                                                                              |
| Findings   | A8, A9, W11, W10 (rest), W12 (rest)                                                                                                                               |
| Base       | `main` after `q4-web-store` is merged                                                                                                                             |
| Read first | CONVENTIONS.md, CODING-GUIDELINES.md, this file                                                                                                                   |
| Estimate   | 4 phases, one commit each                                                                                                                                         |
| Allowed    | `web/src/**/*.css`, `web/src/components/**`, `web/src/three/viewer/useKeyboardShortcuts.ts`, `eslint.config.mjs`, `README.md`, `docs/**`, `CONTRIBUTING.md` (new) |

## 1. Goal

Lower the cost of every future change: the React Compiler can be switched on later without a
rewrite, the CSS has a home per component, and the docs are short enough to stay current.

## 2. Acceptance criteria

**A8 – React Compiler readiness**

- AC-1.1 No ref writes during render (today `useKeyboardShortcuts.ts` assigns
  `cameraRef.current = onCamera` and `orthoRef.current` in the render body → move into
  `useLayoutEffect` or use an effect-event pattern).
- AC-1.2 The `react-hooks` 7 compiler rules are enabled as **warnings**; the handover lists the
  remaining warnings by file. The compiler itself is not enabled.

**W11 – CSS**

- AC-2.1 `web/src/styles.css` keeps only tokens, resets and layout (< 6 KB). Component styles move
  to CSS Modules next to their component (`ObjectRow.module.css`, …) – Vite supports them without
  a dependency.
- AC-2.2 No duplicate selectors (`.sidebar`, `.section-head .tools`), no `!important`, no undefined
  custom properties (`var(--orange, …)`).
- AC-2.3 Visual regression: the suite has no screenshot baselines, so before the CSS move take
  screenshots of fixed views (plater with the calibration cube, settings tab, preview, each dialog)
  with a throwaway Playwright script, repeat after the move, and list every difference in the
  handover. Do not commit the script or the images.

**W10 rest – accessibility**

- AC-3.1 Every `OptionField`/`PresetSelect` label is associated with its control (`htmlFor` + `id`).
- AC-3.2 Clickable `div`/`li`/`span` rows (toasts, legend rows, object/instance/volume rows, library
  folders) become `button`s or get `role`, `tabIndex=0` and Enter/Space handling.

**A9/W12 – docs diet**

- AC-4.1 `README.md` current: cut tool listed as a feature, architecture sketch matches the tree,
  Node badge correct.
- AC-4.2 `docs/UAT-Report.md`, `docs/refactoring/AUDIT.md` and finished work packages move to
  `docs/archive/`; nothing references them as current.
- AC-4.3 `CONTRIBUTING.md` (one page): link to CONVENTIONS, the commands table, how to run e2e.
- AC-4.4 CONVENTIONS: remove stale entries (`threemf.ts` as one file, `.eslint.config.mjs`), add the
  rule "no ticket ids in code comments; the commit message carries the id". Existing comments are
  **not** rewritten in bulk.

## 3. Binding decisions

- No CSS framework, no CSS-in-JS. CSS Modules only.
- Do not enable the React Compiler in this package.

## 4. Phases

1. A8 (AC-1.x). Commit: `Web: compiler-safe hooks, compiler lint rules as warnings (q8-housekeeping)`
2. W11 (AC-2.x). Commit: `Web: component CSS modules, no duplicates or !important (q8-housekeeping)`
3. W10 rest (AC-3.x). Commit: `Web: labelled fields and keyboard-reachable rows (q8-housekeeping)`
4. Docs (AC-4.x) + handover. Commit: `Docs: current README, archive, CONTRIBUTING (q8-housekeeping)`

## 5. Review checklist

- [ ] No render-time ref writes; compiler warnings listed.
- [ ] `styles.css` < 6 KB, before/after screenshot differences listed and explained.
- [ ] Labels associated; rows keyboard-reachable.
- [ ] README current; archive in place.
