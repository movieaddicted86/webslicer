# Work package Q4 – Split the plater slice, three.js boundary

|            |                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package id | `q4-web-store` (branch `feature/q4-web-store`)                                                                                                                                                         |
| Findings   | W2, A5 (web), A6, W4 (web rest)                                                                                                                                                                        |
| Base       | `main` after `q1-toolchain` is merged                                                                                                                                                                  |
| Read first | CONVENTIONS.md (web specifics), CODING-GUIDELINES.md, this file                                                                                                                                        |
| Estimate   | 4 phases, one commit each                                                                                                                                                                              |
| Allowed    | `web/src/state/**`, `web/src/plater/**`, `web/src/three/**`, `web/src/components/sidebar/AddVolumeMenu.tsx`, import-path updates in any web file after a move, `eslint.config.mjs`, tests next to them |

## 1. Goal

`web/src/state/slices/plater.ts` (34.2 KB at `eb00fa4`, +22 % in one day) is split along the
pattern that already works for `paint`, `ranges` and `cut`. three.js is imported only where it is
needed, so a three.js upgrade touches `three/` and nothing else, and `state/` ↔ `three/` no longer
form a runtime cycle.

## 2. Acceptance criteria

- AC-1 `slices/plater.ts` < 15 KB. New parts follow the existing `SlicePart<XSlice>` pattern of
  `paint`, `ranges` and `cut` (spread into `createPlaterSlice`): `instances.ts` (add/remove/set
  count/fill bed/instance to object), `merge.ts` (merge objects), `split.ts` (split to
  objects/parts) and `transform.ts` (place on face, mirror, drop to bed, arrange) – all four are
  required. Public action names on `useStore` unchanged.
- AC-2 ESLint `no-restricted-imports`: `three` and `three/examples/**` may be imported only in
  `web/src/three/**` and in `web/src/state/types.ts` (type-only import, `import type`).
  `npm run lint` passes with the rule on. Phase 2 starts with a complete list of `from 'three'`
  (and `three/examples`) imports outside `three/` at the base.
- AC-3 Consequences of AC-2 (known cases; the Phase 2 list is authoritative):
  - `slices/plater.ts` imports `three`, `three/paint` and `three/geometry` at runtime, and
    `mergeObjects` calls `new THREE.BufferGeometry` → move the geometry work into a function in
    `three/` that the action calls.
  - The quaternion maths of `placeObjectOnFace` moves to `three/` (or `shared/src/math` if it can
    be written without three).
  - `plater/objects.ts` (`instanceBounds` returns `THREE.Box3`) → move to `three/` or return a plain
    `{ min, max }` box from `shared/src/math`; update callers.
  - `plater/camera.ts` moves to `three/viewer/cameraMath.ts` with its `camera.test.ts`
    (`three/viewer/camera.ts` already exists – do not overwrite it).
  - `AddVolumeMenu.tsx` imports `three/loaders` and `three/primitives` → call store actions instead.
  - `plater/info` no longer imports `three/geometry`.
- AC-4 Direction is one-way: `three/viewer/**` may import `state/store` (the viewer reads the
  store), but no file in `state/**` imports a module from `three/**` at runtime (today
  `slices/cut`, `slices/paint` and `slices/job` do). Logic they need moves to `plater/` (pure) or
  is passed in by the caller. The store no longer stores the viewer callback `renderThumbnails`;
  the viewer registers it through a plain setter in `three/` or passes it at call time.
- AC-5 The upload `try/catch` + `uploadError` toast block exists once (helper in `state/`), used by
  `addObjects`, `uploadVolume`, `splitToParts`, `startPaint`.
- AC-6 Behaviour unchanged: `npm test -w web` (incl. `store.test.ts`), `npm run e2e:docker` green;
  manual check of UAT-04, 05, 06, 09–13 identical.

## 3. Binding decisions

- **`THREE.BufferGeometry` stays in `PlaterObject`/`PlaterVolume`.** A full adapter layer around
  three.js would be over-engineering here; the type-only import in `state/types.ts` is the one
  allowed coupling.
- Move code, do not rewrite it. Undo/redo semantics (`recordHistory()` before every change,
  `sliceDirty: true`) stay exactly as they are; double undo steps are fixed in q5, not here.
- No new state library, no immer, no context providers.

## 4. Phases

### Phase 0 – Baseline

- `npm test -w web`, `npm run e2e:docker`; byte sizes of all files in `state/slices/`, `plater/`,
  `three/`. Run the repo's own cycle check (`server/scripts/cycles.ts` / the existing `.madgerc`)
  over `web/src` and keep the output; it confirms or refutes the folder-level `state` ↔ `three`
  cycle that AC-4 removes. No commit.

### Phase 1 – Slice split

- Create the new slices (AC-1), move actions with their helpers, compose in `store.ts`.
- Check: AC-6. Commit: `Web: split the plater slice by area (q4-web-store)`

### Phase 2 – three.js boundary

- AC-2, AC-3. Add the lint rule last, after the moves make it pass.
- Check: AC-6, `npm run lint`. Commit: `Web: three.js only in three/, enforced by lint (q4-web-store)`

### Phase 3 – Cycle and duplicate removal

- AC-4, AC-5. Re-run the cycle listing; report before/after.
- Check: AC-6. Commit: `Web: no runtime cycle between state and three, one upload error path (q4-web-store)`

### Phase 4 – Docs and handover

- CONVENTIONS §1 file map and the web-specifics bullet on three.js. CHANGELOG bullet.
- Handover: sizes before/after, cycle listing before/after.
- Commit: `Docs: web store layout and three.js boundary (q4-web-store)`

## 5. Pitfalls

- Slices share one flat namespace; a moved action that calls `get().otherAction()` keeps working,
  but watch name collisions between new slice interfaces.
- `store.test.ts` drives actions through `useStore.getState()`; it must pass unchanged.
- `window.webslicer` (debug handle) must still expose the same actions.

## 6. Review checklist

- [ ] `plater.ts` < 15 KB; action names unchanged.
- [ ] Lint blocks `three` outside `three/` (and the type import in `state/types.ts`).
- [ ] No runtime `state → three` import; cycle listing clean.
- [ ] e2e and UAT checks identical.
