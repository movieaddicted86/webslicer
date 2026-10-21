# Work package P1.3 – Instances

|            |                                                                  |
| ---------- | ---------------------------------------------------------------- |
| Package id | `p1.3-instances` (branch `feature/p1.3-instances`)               |
| Roadmap    | `TODO.md` → P1 item 3                                            |
| Base       | `main` at commit `b6dce81` or later                              |
| Read first | [CONVENTIONS.md](CONVENTIONS.md) (binding), this file completely |
| Estimate   | 6 phases, one commit each                                        |

Line numbers below refer to `b6dce81`; search for the named symbol if they moved.

## 1. Goal

Like PrusaSlicer, an object can have several **instances**: copies that share the mesh, volumes
(modifiers, enforcers…), paint, height ranges and per-object settings, but each has its own
position, rotation and scale. Users print 1–n copies without duplicating and editing objects one by
one. "Duplicate" (⧉, independent copies) keeps working as today.

## 2. User stories and acceptance criteria

**US-1 Add / remove instances.** As a user I press `+` (or the toolbar button) to add an instance of
the selected object and `-` to remove the last one.

- AC-1.1 `+` adds one instance, placed on free bed space (arrange), the new instance is selected.
- AC-1.2 `-` removes the last instance; with one instance left, `-` does nothing.
- AC-1.3 Both are undoable with Ctrl+Z / Ctrl+Y and mark the plater as changed (`sliceDirty`).

**US-2 Set number of instances.** In the object manipulation panel I type a number of instances.

- AC-2.1 Field "Instances" accepts 1–1000; more instances are added and arranged, surplus ones are
  removed from the end. Invalid input is rejected without changing the plater.

**US-3 Fill bed.** "Fill bed with instances" adds as many instances as fit on the bed.

- AC-3.1 After the action all instances of all objects lie inside the bed (no red "outside" state)
  and adding one more instance would not fit (within the packing algorithm of `arrange`).

**US-4 Per-instance transform.** In the object list I expand an object with ≥2 instances and select
"Instance 2"; moving/rotating/scaling (gizmo or numeric fields) changes only that instance.

- AC-4.1 Clicking an instance in the 3D view selects the object _and_ that instance.
- AC-4.2 Selecting the object row edits instance 1. The numeric fields show the selected instance.
- AC-4.3 Place on face (F) and "drop to bed" act on the selected instance.
- AC-4.4 `Del` on a selected instance removes that instance (if more than one), otherwise the object.
- AC-4.5 "Set as separate object" on an instance turns it into an independent object (deep copy,
  like Duplicate) and removes it from the original.

**US-5 Shared object data.** Editing settings, modifiers, paint or height ranges of the object is
visible on all instances immediately.

**US-6 Slicing.** Slicing an object with n instances prints n copies.

- AC-6.1 The G-code has n copies: preview shows them; filament use ≈ n × single copy (±5 %).
- AC-6.2 The job 3MF (and "Save project") contains **one** `<object>` with n `<item>`s in
  `<build>` and `instances_count="n"` in `Metadata/Slic3r_PE_model.config`, so desktop
  PrusaSlicer opens it with n instances of one object.

**US-7 Projects and autosave.** Saving a project / autosave and loading it restores the objects with
their instances (count and transforms). A 3MF from desktop PrusaSlicer with instances loads with
instances too.

Out of scope: per-instance settings (PrusaSlicer has none either), sequential printing order,
mirror (P1.4 builds on per-instance scale), cut/split.

## 3. Binding design decisions

### 3.1 Data model (web)

```ts
// web/src/state/store.ts
export interface PlaterInstance {
  id: string; // 'inst-N', module counter like obj-/vol-/rng-
  position: [number, number, number];
  rotation: [number, number, number]; // Euler XYZ, radians
  scale: [number, number, number];
}
export interface PlaterObject {
  // … as today, but WITHOUT position/rotation/scale …
  instances: PlaterInstance[]; // always ≥ 1
}
```

- `position/rotation/scale` move from `PlaterObject` into `instances[]`. Do **not** keep copies on
  the object (no duplicated state).
- Geometry, volumes, paint, ranges, config, extruder, name, visible stay per object.
- New selection field `selectedInstanceId?: string`, analogous to `selectedVolumeId`: only valid
  when exactly one object is selected; `undefined` means instance 1. `select()` resets it.
- Helpers (replace the current ones, update all call sites):
  - `instanceMatrix(inst: PlaterInstance): THREE.Matrix4` (replaces `objectMatrix`, store.ts:324)
  - `instanceBounds(o, inst): THREE.Box3` (replaces `objectBounds`, store.ts:339)
  - `objectBounds(o): THREE.Box3` = union over all instances (for whole-object checks)
  - `selectedInstance(state, o): PlaterInstance` = selected instance or `o.instances[0]`
- `updateObject(id, patch)` must no longer accept transforms; add
  `updateInstance(objectId, instanceId, patch: Partial<Pick<PlaterInstance, 'position' | 'rotation' | 'scale'>>)`.
- New actions: `addInstances(objectId, count = 1)`, `removeInstance(objectId, instanceId?)`
  (default: last), `setInstanceCount(objectId, n)`, `fillBedWithInstances(objectId)`,
  `instanceToObject(objectId, instanceId)`, `selectInstance(objectId, instanceId)`.
  All call `recordHistory()` first and set `sliceDirty: true`.

### 3.2 Slice request / API contract

```ts
// server/src/jobs.ts SliceObjectInput and mirrored type in web/src/api.ts
transform: number[];        // unchanged meaning: instance 1 (keeps old clients valid)
instances?: number[][];     // NEW: all instance transforms incl. the first, column-major 4×4
```

- Web: `buildSliceRequest` (store.ts:1076) sends `transform = instances[0]` matrix and
  `instances` = all matrices when there is more than one instance.
- Server: `const transforms = o.instances?.length ? o.instances : [o.transform]`.
- Validation (`validateSliceRequest`, api.ts:507): `instances` optional array, 1–1000 entries, each
  exactly 16 finite numbers.

### 3.3 3MF writer and reader (server/src/slicer/threemf.ts)

- `ThreeMfObject` gets `instances?: number[][]`. `build3mf` writes one `<item objectid="k" …>`
  per instance transform (store.ts order) and `instances_count` (threemf.ts:366) = number of
  instances. Object meshes stay in object coordinates (unchanged).
- `read3mfProject` additionally returns, per object, `instances: number[][]` (column-major) taken
  from `<build><item>` of `3D/3dmodel.model`, matched by `objectid` to the object ids in
  `Slic3r_PE_model.config`, in build order. Also return `buildOrder: number[]` = object index of
  every build item (needed by the web import, see 3.4). Items without transform = identity.

### 3.4 Import (web/src/importFiles.ts)

Current code maps `loadModelFile()` result _i_ to project object _i_ (importFiles.ts:39). That is
already wrong for files with instances: three's `ThreeMFLoader` returns **one mesh per build item**
(in build order) with the item transform baked into the geometry (loaders.ts:72, collectMeshes).

New behaviour for 3MF projects:

1. Use `buildOrder` to find, for each project object, the first build item _k_ and its loaded mesh.
2. Un-bake: apply the inverse of the item-_k_ transform to that geometry → object coordinates.
3. `addObjects` normalises geometry by an offset _c_ (centre XY, min Z = 0, store.ts:742). The
   world matrix of instance _j_ is therefore `T_item_j · Translate(c)`. Decompose it into
   position / quaternion→Euler XYZ / scale. Pass the instances to `addObjects` (extend
   `ImportItem` with `instances?: Array<{position, rotation, scale}>` or matrices) and keep
   `keepPositions` behaviour.
4. Ignore the meshes of further build items of the same object (they are the baked copies).
5. Plain STL/OBJ/AMF and 3MF files without `Slic3r_PE_model.config` keep today's behaviour.

Autosave restore uses the same path (`restoreAutosave` → `importFiles`), so it is covered.

### 3.5 Viewer (web/src/three/Viewer.tsx)

- Per instance one scene node; all instance meshes of an object share the object's
  `BufferGeometry` and the volume geometries (no `clone()` of geometry – paint colours are vertex
  attributes and must show on all instances).
- `userData` on instance nodes carries `objectId` and `instanceId`; picking (≈ Viewer.tsx:557)
  selects both. The TransformControls gizmo attaches to the selected instance node and writes via
  `updateInstance`.
- Paint strokes (≈ Viewer.tsx:460–495) raycast against the hit instance and convert the hit
  point with _that_ instance's matrix; the painted triangle indices are the same for all instances.
- Outside-bed highlight per instance (`objectIsOutside` → check per instance).
- Thumbnails need no change (they render the objects group).

### 3.6 Arrange and fill bed

- `arrange` (store.ts:1029) packs **instances** as items (footprint = `instanceBounds`), not objects.
- `fillBedWithInstances`: footprint of the selected instance + spacing (same spacing as arrange);
  start with `floor(bedW / w) * floor(bedH / h)` minus the footprint area already used by other
  instances, then decrease the count until `arrange()` leaves every instance inside the bed.
  Cap at 1000. The packing itself lives in the pure module `web/src/plater/packing.ts` (phase 3).

### 3.7 UI (web/src/components/Sidebar.tsx, Viewer.tsx, Dialogs.tsx)

- Object toolbar (Sidebar.tsx ≈ 640–680): buttons "Add instance (+)" and "Remove instance (−)",
  disabled without a selected object.
- Object row: badge `×n` when n > 1; expandable sub-list "Instance 1 … n" (like volumes). Instance
  rows: select on click, context actions "Set as separate object" and delete.
- `ObjectManipulation` (Sidebar.tsx:274): numeric field "Instances" (US-2), button "Fill bed";
  position/rotation/scale fields edit the selected instance.
- Keyboard (Viewer.tsx `onKey`, line 828): `+` / `=` and numpad `+` add, `-` and numpad `-` remove.
  Not while typing in inputs (follow the existing guard in that handler). Works in all modes.
- Add `+`/`-` to the shortcut line in `Dialogs.tsx:501`.
- Simple mode hides the object list and the manipulation panel (Sidebar.tsx:639 / 768). Add the
  "Add instance (+)" / "Remove instance (−)" buttons to the Simple toolbar (Sidebar.tsx ≈ 772) as
  well; the keys work in all modes.

## 4. Phases

Commit after each phase; every phase must leave the app working (definition of done in
CONVENTIONS §5 applies per phase, docs only in phase 6).

### Phase 0 – Baseline

- Create the branch. Run both type checks, `npm test`, `npm run build`, start Docker + Vite.
- Note the baseline test results in your report. No commit.

### Phase 1 – Data model refactor, behaviour unchanged

- Introduce `PlaterInstance`, `instances[]`, the helpers and `updateInstance`; every object has
  exactly one instance. Replace all uses of `o.position/rotation/scale`, `objectMatrix`,
  `objectBounds` (store.ts ≈ 28 places, Sidebar.tsx ≈ 18, Viewer.tsx ≈ 12 – grep for them).
- `duplicateObjects` (store.ts:847) deep-copies instances with new ids.
- Check: type checks; browser regression UAT-04, 05, 06, 09, 10, 11, 12, 13 behave exactly as before.
- Commit: `Plater: move object transforms into instances (p1.3-instances)`

### Phase 2 – Server: request, 3MF writer and reader

- Implement 3.2 and 3.3 incl. validation and the mirrored web types (`web/src/api.ts`).
- Unit tests in `threemf.test.ts`:
  - writer: object with 3 instances → 1 `<object>`, 3 `<item objectid="1">` with the 3 transforms,
    `instances_count="3"`;
  - reader: roundtrip returns `instances` (3 matrices, equal within 1e-6) and `buildOrder` `[0,0,0]`;
  - mixed file (object A with 2 instances, object B with 1) → correct mapping and order;
  - item without `transform` → identity.
- Validation tests (new `server/src/routes/api.test.ts` if needed, export the validator): rejects
  `instances: []`, 1001 entries, an entry with 15 numbers, `NaN`.
- Commit: `Server: write and read 3MF instances (p1.3-instances)`

### Phase 3 – Store actions, viewer, arrange

- Implement the actions of 3.1, viewer per-instance nodes (3.5), arrange per instance and fill bed
  (3.6). `buildSliceRequest` sends `instances`.
- Move the shelf packing out of `arrange` into a pure, dependency-free module
  `web/src/plater/packing.ts` (input: footprints + bed rectangle, output: positions or "does not
  fit"); `arrange` and `fillBedWithInstances` use it. Unit tests in
  `web/src/plater/packing.test.ts` (node:test + assert): items fit/overflow, fill count for a
  20×20 mm footprint on a 250×210 bed with 6 mm spacing, existing items reduce the count.
- Web test runner (allowed change): add `"test": "tsx --test src/**/*.test.ts"` to
  `web/package.json` and change the root `test` script to
  `npm run test -w server && npm run test -w web`. `tsx` is already installed at the root; do not
  add other test frameworks.
- Browser check: `+` three times on the calibration cube → 4 cubes, arranged, slice → preview shows
  4 cubes, filament ≈ 4 × UAT-06 value.
- Commit: `Plater: instances in store, viewer and arrange (p1.3-instances)`

### Phase 4 – UI

- Toolbar buttons, object list sub-rows, manipulation fields, keyboard, shortcut help (3.7),
  "Set as separate object".
- Browser checks for AC-1.x, 2.1, 3.1, 4.1–4.5, 5. Paint support on instance 2 → visible on all.
- Commit: `UI: instance controls in object list, manipulation panel and keys (p1.3-instances)`

### Phase 5 – Projects, autosave, PrusaSlicer files

- Implement 3.4. Checks:
  - Save project with 2 objects (3 + 1 instances) to the library, delete all, open → same layout.
  - Autosave: reload the tab → restore → same layout.
  - Open the saved 3MF in desktop PrusaSlicer if available (otherwise inspect the XML) → one object
    with 3 instances.
  - A 3MF with instances exported from desktop PrusaSlicer (create one or ask Robert for one)
    loads with instances and correct positions.
- Commit: `Import: restore instances from 3MF projects and autosave (p1.3-instances)`

### Phase 6 – Docs and handover

- `CHANGELOG.md` Unreleased bullet; `TODO.md` P1 item 3 `[x]`; `docs/Feature-Comparison.md`
  instances row → ✅ with a short note; new `docs/UAT.md` case **UAT-20 Instances** (steps from
  AC-1 to AC-7 in one table row, same style as UAT-19).
- Handover report per CONVENTIONS §8.
- Commit: `Docs: instances (p1.3-instances)`

## 5. Pitfalls (read before coding)

- `objectBounds` is used for drop-to-bed, arrange and the outside check – decide per call site
  whether it means _one instance_ or _the whole object_.
- Euler angles: keep `'XYZ'` order everywhere (store.ts:326); decomposing an imported matrix with
  non-uniform scale and rotation can produce shear – accept the decomposition, do not try to fix
  the mesh.
- `addObjects` mutates the geometry (centre/translate) – un-bake before calling it, and compute
  instance matrices with the offset it applies (3.4 step 3).
- `mergeUploadState` (store.ts:1279) and undo/redo snapshots copy objects – make sure instances
  are copied, not shared by reference across history entries.
- Height ranges are in object Z (from the object's bottom). With per-instance scale PrusaSlicer
  still applies them per object – leave them as they are.
- The job outputName counts objects (`_and_N_more`, store.ts:1109) – keep counting objects.
- Large counts: 1000 instances of a big mesh must not clone geometry (memory) – share it.

## 6. Review checklist (lead developer)

- [ ] No `position/rotation/scale` left on `PlaterObject`; no geometry clones per instance.
- [ ] Old clients: a request without `instances` still slices (server fallback).
- [ ] 3MF tests cover writer, reader, mixed objects, identity item.
- [ ] Undo/redo restores instance count and transforms.
- [ ] Desktop PrusaSlicer opens the project with instances.
- [ ] Docs, UAT-20 and handover report present; branch not merged.
