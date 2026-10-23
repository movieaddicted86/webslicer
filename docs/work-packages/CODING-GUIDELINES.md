# WebSlicer – Coding guidelines (architecture and clean code)

Binding for all code, together with [CONVENTIONS.md](CONVENTIONS.md) (process, tests, git).
Goal: one implementation per concept, small modules with one job, types defined once and reused,
code that a newcomer can navigate by folder name. Rules marked **MUST** are review blockers.

## 1. Principles

- **Single source of truth (DRY).** A concept – a type, a formula, a constant, an algorithm – exists
  once. Copies across web and server are bugs waiting to happen (P1.3 and T-001 had exactly such
  bugs). Rule of three does not apply to domain logic: the _second_ copy is already one too many.
- **Single responsibility.** A module, class or function does one thing. If its description needs
  "and", split it.
- **Pure core, thin shell.** Domain logic (geometry, transforms, packing, G-code parsing, preset
  diffing, config merging) is written as pure functions without React, Zustand, Express, DOM or
  file I/O. Components, store actions, routes and the MCP layer only orchestrate.
- **Composition over inheritance.** Build behaviour from small functions and types; use class
  inheritance only for real "is-a" hierarchies with shared state (rare here).
- **Explicit over clever.** Clear names, no hidden side effects, no magic numbers.

## 2. Architecture and module boundaries

```
shared/            @webslicer/shared – pure, dependency-free TypeScript used by web AND server
  src/types/       API contract types (SliceRequest, JobRecord, Config, CustomGcode, …)
  src/math/        column-major Matrix4 helpers, placement compose/decompose, mirror
  src/plater/      packing, normalisation, split, preset diff, … (pure algorithms)
server/src/
  routes/          HTTP only: parse + validate input, call services, map errors → status codes
  services/ (new)  use cases (slice job, projects, library, printers) – no Express types
  slicer/          PrusaSlicer integration: CLI, 3MF, presets, schema, G-code info
  mcp/             MCP transport + tool definitions (call services, never routes)
web/src/
  api/             HTTP client per area (one file per resource), no state
  state/           Zustand store split into slices (see §5), no three.js scene code
  three/           rendering, picking, gizmos – adapters between shared math and THREE
  gcode/           G-code parsing and preview colouring (pure, worker-safe)
  components/      React UI, one component per file for anything > ~150 lines
```

- **MUST:** dependencies point downwards only: `components → state → shared/api`,
  `three → state/shared`, `routes/mcp → services → slicer/shared`. No import cycles; `shared/`
  imports nothing from web or server.
- **MUST:** code needed by web and server lives in `shared/`. No mirrored copies, no "keep in sync"
  comments.
- three.js types (`THREE.Matrix4`, `Vector3`) stay in `web/src/three` and thin adapters; shared math
  works on plain `number[]` / tuples.

## 3. Types and interfaces

- **MUST:** a type is declared once (in `shared/src/types` if it crosses the API, otherwise next to
  its owner) and imported everywhere else. `web/src/api.ts` holds no declarations of its own – it
  imports the contract types from `shared/src/types` and re-exports them.
- Build hierarchies with `extends` and utility types instead of repeating fields:
  ```ts
  export type Vec3 = [number, number, number];
  export interface Placement { position: Vec3; rotation: Vec3; scale: Vec3 }
  export interface PlaterInstance extends Placement { id: string }
  export interface PlaterVolume extends Placement { id: string; type: VolumeType; … }
  ```
  (Today `Placement`, `PlaterInstance`, `ImportTransform`, `IDENTITY_PLACEMENT` and the volume fields
  repeat the same three tuples.)
- Use **discriminated unions** for variants (`{ kind: 'stl' } | { kind: '3mf'; … }`), not optional-field soup.
- Use `Pick`, `Omit`, `Partial`, `Readonly` to derive request/patch types from the entity type.
- Prefer `interface` for object shapes, `type` for unions, tuples and mapped types. No `any`, no
  non-null `!` where a guard is cheap. Exported functions have explicit return types.
- Constants with meaning (`IDENTITY_MATRIX`, grid tolerances, limits like 1000 instances) live in
  one `constants.ts` per area and are imported, never re-typed.

## 4. Functions and files

- Functions ≤ ~40 lines and ≤ 4 parameters (more → an options object). One level of abstraction per
  function; extract helpers instead of nesting deeper than 3 levels.
- Files: soft limit **400 lines**, hard review question above 600. Split by responsibility, not
  alphabetically.
- Names: verbs for functions (`computeBounds`), nouns for data, `is/has` for booleans; no
  abbreviations except established ones (`gcode`, `mmu`, `3mf`).
- Comments explain _why_; the code explains _what_. Every exported function/type gets a one-line
  JSDoc.
- Errors: throw typed errors in the core (`class ValidationError extends Error`), map them to HTTP
  status codes in exactly one place per layer.

## 5. Web specifics

- **Store slices:** `store.ts` is split into slice creators (`createPlaterSlice`, `createPresetSlice`,
  `createJobSlice`, `createPreviewSlice`, `createUiSlice`, `createHistorySlice`, `createToolsSlice`)
  combined in one `useStore`. Slices call pure functions from `shared/` / `web/src/plater/` for all
  calculations.
- **Components:** presentational components receive props; container components read the store.
  Repeated UI patterns (numeric XYZ fields, section headers, toolbar buttons with shortcut tooltip,
  modal frame) become shared components in `components/common/`.
- **Viewer:** `Viewer.tsx` becomes a composition of hooks/modules (`useScene`, `usePlaterObjects`,
  `useGizmo`, `useGcodePreview`, `usePainting`, `useKeyboardShortcuts`). Keyboard shortcuts are
  defined once in a table that the handler _and_ the help dialog read.
- **Tools:** a plater tool (cut, paint, place on face, variable layer height, the transform gizmo) is
  one entry in `web/src/tools/registry.ts`: id, title, icon, group, panel kind, shortcut, `aboutAt`
  (its place in the About line) and `isAvailable(state)`. The left tool bar, the shortcut table and
  the About dialog are generated from that list, and opening/closing goes through
  `openTool`/`closeTool` (the `tools` slice, lifecycle in `tools/activate.ts`), so a new tool needs
  no button, shortcut or help line. A tool with panel options adds a component under
  `components/tools/panels/` and a `panel` kind in `ToolDock.tsx`; it builds its body from the shared
  frame (`ToolPanel`) and the field blocks under `components/tools/fields/`. The panel's position and
  size live in CSS only. Tool options do not go into the sidebar.
- Hooks start with `use`, live next to their consumer or in `web/src/hooks/` when reused.

## 6. Server specifics

- Routes stay thin (validate → service → respond). Validation schemas are defined once (zod is
  already a dependency since T-006) and shared by REST and MCP.
- Services own I/O (files under `data/`, the CLI). The 3MF writer/reader and the G-code tools stay pure
  where possible (buffers in, buffers/objects out).

## 7. Refactoring rules

- Refactoring never changes behaviour: every step keeps all tests green, and new tests pin the
  behaviour **before** code moves.
- Small steps, one concern per commit (`Refactor: move placement math to shared (R-2)`).
- Delete dead code and duplicate helpers in the same commit that introduces the shared version.
- If a rule here does not fit a case, document the exception in the commit body – do not silently deviate.
