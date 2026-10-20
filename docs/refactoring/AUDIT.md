# WebSlicer – code audit against the coding guidelines

Scope: `web/src`, `server/src` at `21a2ace` (`main` after the T-008 merge).
Rules applied: [CODING-GUIDELINES.md](../work-packages/CODING-GUIDELINES.md) (referred to by §) and
[CONVENTIONS.md](../work-packages/CONVENTIONS.md).
This is the basis for the refactoring steps R-1 … R-12; **no production code changed in this step**
(T-010).

## How this audit was made (reproduce)

| Tool | Command | Result (summary) |
|---|---|---|
| Duplication | `npx jscpd@4 web/src server/src --min-lines 6 --min-tokens 45` | 21 clones, 456 duplicated lines (3.11 %) – 16 of the clones are web↔server |
| Larger blocks | `npx jscpd@4 … --min-lines 20 --min-tokens 200` | 4 clones: `packing.ts` web↔server (75 L/1200 t), its test (77 L/1475 t), `values.ts` web↔server (32 L/418 t and 21 L/300 t) |
| Unused exports | `npx ts-prune@0.10 -p web/tsconfig.json` | 39 module-private-but-exported symbols (see F-24) |
| Import cycles | `npx madge@8 --circular web/src` and `--circular server/src` | 1 cycle in web, 2 in server (F-19) |
| Size | `wc -l` per file | 12 non-test files > 400 lines (F-09 … F-16) |

Line numbers are those of the state above; they shift with every merge, so each finding names the
symbol next to the line.

## Metrics before

| Metric | Value |
|---|---|
| `web/src` non-test / test lines | 8 743 / 761 (41 files) |
| `server/src` non-test / test lines | 6 813 / 1 548 (41 files) |
| Files > 400 lines (guideline soft limit) | 12 – `store.ts` 1861, `Viewer.tsx` 1384, `Sidebar.tsx` 1039, `slicer/layout.ts` 944, `slicer/threemf.ts` 632, `Dialogs.tsx` 627, `routes/api.ts` 565, `mcp/tools.ts` 521, `jobs.ts` 502, `slicer/schema.ts` 475, `PreviewPanel.tsx` 462, `api.ts` 414 |
| Duplicated lines (jscpd, ≥ 6 L / ≥ 45 tokens) | 456 in 21 clones (3.11 %); ≥ 20 L / ≥ 200 tokens: 201 in 4 clones (1.35 %) |
| Web↔server duplicates | 11 (packing ×2 incl. the test, values ×5, thumbnails, `bedShapeOf`, `arrangementSpacing`, 3MF matrix/normalisation, `asyncHandler` ×4) |
| Mirrored type declarations (`web/src/api.ts` ↔ server) | 12 (`OptionDef`, `LayoutGroup`, `LayoutPage`, `TabLayout`, `Schema`, `PresetSummary`, `PrinterModel`, `GcodeInfo`, `JobStatus`, `JobRecord`, `JobEvent`, `CustomGcode`/`VolumeType`) |
| Import cycles | 3 |
| Unused exports | 39 |
| `shared/` workspace | does not exist yet (root `package.json` workspaces: `server`, `web`) |

## Findings

Severity: **high** = duplicated domain logic or types (behaviour can drift apart), **medium** =
oversized or mixed-responsibility modules, wrong layer, cycles, **low** = style, dead code,
presentation.

### Duplicated domain logic (high)

| Id | § | Location | Finding | Sev |
|---|---|---|---|---|
| F-01 | §1, §2 | `web/src/plater/packing.ts:1` ↔ `server/src/plater/packing.ts:1` | The whole shelf packer (`PackItem`/`PackedItem`/`BedRect`, `packShelf`, `fillCount`) exists twice, **75 lines identical**; only the doc comment and the import extension differ. The tests are duplicated too (`web/src/plater/packing.test.ts` ↔ `server/src/plater/packing.test.ts`, 77 identical lines incl. the `BED` constant) | high |
| F-02 | §1, §2 | `web/src/state/store.ts:614` ↔ `server/src/plater/packing.ts:87` | `bedShapeOf` is byte-identical apart from the return type (web also returns `points`); the default `'0x0,200x0,200x200,0x200'` is typed twice | high |
| F-03 | §1 | `web/src/state/store.ts:502` ↔ `server/src/plater/packing.ts:103` | `arrangementSpacing` – the server copy is even documented as "Port of `arrangementSpacing` in `web/src/state/store.ts`". The only difference is `toBool` vs an inline `=== '1' \|\| === 'true'`, i.e. a correctness trap | high |
| F-04 | §1, §2 | `web/src/values.ts:1` ↔ `server/src/slicer/values.ts:1` | Five clones (32, 12, 33, 17, 21 lines, incl. two > 20 L): `escapeStringCstyle`, `unescapeStringCstyle`, `escapeStringsCstyle`, `unescapeStringsCstyle`, `parsePoints`, `isVector`/`VECTOR_TYPES`. This is the PrusaSlicer config-file format – parsing a config in the browser and in the CLI must never differ | high |
| F-05 | §1, §2, §3 | `server/src/plater/normalize.ts:1` ↔ `web/src/state/store.ts:440` + `web/src/state/store.ts:966` + `web/src/plater/transform.ts:9` | Matrix/placement maths twice: `IDENTITY`, `translateMatrix`, `multiplyMatrix`, `applyMatrix`, `meshBounds`, `instanceBounds`, `normalizationOffset`/`normalize` on the server are a hand-port of the browser's `instanceMatrix`/`instanceBounds`/`placementMatrix` and the normalisation inside `addObjects` ("centre XY at origin, min Z at 0", offset `c`, `M_j · Translate(c)`). The browser copy is three.js-typed, which is exactly what pushes the server into a second implementation | high |
| F-06 | §1, §2 | `web/src/importFiles.ts:19` ↔ `server/src/plater/project.ts:81` | 3MF project round trip twice: object coordinates + one build-item transform per instance, un-baking the item transform on import (web) and re-baking it on export (server). The web comment (`store.ts:980`) and the server comment (`normalize.ts:1`) describe the same formula in two places | high |
| F-07 | §1, §3 | `web/src/three/thumbnail.ts:12` ↔ `server/src/slicer/thumbnails.ts:76` | `parseThumbnailSpec` (spec string → `{width,height,format}` list) duplicated, 9 identical lines; the browser and the CLI must agree on which thumbnails a preset asks for | high |
| F-08 | §3 | `web/src/api.ts:1` ↔ `server/src/slicer/schema.ts:27`, `presets.ts:14`, `bundles.ts:11`, `gcodeInfo.ts:3`, `jobs.ts:18/63/79`, `slicer/threemf.ts:20` | The API contract is mirrored: 12 type declarations with the same fields (`OptionDef`, the layout triple, `Schema`, `PresetSummary`, `PrinterModel`, `GcodeInfo`, `JobStatus`, `JobRecord`, `JobEvent`, `CustomGcode`, `VolumeType`, `SliceRequest`). Any server-side field addition has to be repeated by hand – the guideline names this as the reason for `shared/src/types` | high |
| F-09 | §3 | `web/src/plater/transform.ts:9`, `web/src/state/store.ts:34/52`, `web/src/importFiles.ts:19`, `server/src/plater/normalize.ts:13` | The `position`/`rotation`/`scale` triple is re-declared per entity (`Placement`, `PlaterInstance`, `PlaterVolume`, `ImportTransform`, an inline literal in `NewVolumeInput`, `Bounds` on the server) instead of `Vec3` + `extends Placement` as §3 shows | high |
| F-10 | §1, §3 | `web/src/state/store.ts:24` with `web/src/three/paint.ts:10`, `web/src/state/store.ts:578` | The store imports three.js geometry helpers (`shellGeometry:508`, `objectFrameOffset:521`, `geometrySize:527`, `triangleCount:533`, `geometryToStl:578`) and the paint codecs (`encodePaint`/`decodePaint`/`subdivideForPainting`), i.e. rendering/format code inside the state layer (§2 MUST: `state` may use `shared`/`api`, three.js adapters live in `three/`) | high (mixed, see also F-12) |

### Oversized and mixed-responsibility modules (medium)

| Id | § | Location | Finding | Sev |
|---|---|---|---|---|
| F-11 | §4, §5 | `web/src/state/store.ts` (1861 L) | One `create<State>` body spans lines 625–1806 (~1180 L) and the `State` interface alone is 207 L (141–347). It carries the plater, presets, schema, jobs, preview, painting, history, toasts, localStorage persistence and file import – §5 asks for `createPlaterSlice`/`createPresetSlice`/`createJobSlice`/`createPreviewSlice`/`createUiSlice`/`createHistorySlice` | medium |
| F-12 | §4, §5 | `web/src/three/Viewer.tsx` (1384 L) | One component does the scene setup (`useEffect` 520–797), the bed (`loadBedAssets:93`, `buildBed:138`), camera framing (`fitCamera:192`, `frameBox:246`), the G-code meshes and the layer range (`fillGcodeColors:211`, `buildGcode:252`, `applyGcodeRange:380`), the volume meshes (455–483), the plater sync (814–1024), shells (1026), painting, gizmo, keyboard handling and the overlay JSX – §5 names the hooks to extract | medium |
| F-13 | §4, §5 | `web/src/components/Sidebar.tsx` (1039 L) | Eight components in one file (`TransformInputs:32`, `RangePanel:132`, `PaintPanel:190`, `ObjectManipulation:276`, `VolumeManipulation:399`, `AddVolumeMenu:460`, `QuickSettings:552`, `Sidebar:625`); §2 wants one component per file above ~150 lines | medium |
| F-14 | §4 | `web/src/components/dialogs/Dialogs.tsx` (627 L), `web/src/components/PreviewPanel.tsx` (462 L) | Eight dialogs in `Dialogs.tsx` (11–602) including `ObjectSettingsDialog` (483) with its own schema filtering; `PreviewPanel` mixes the slider, the legend, the custom-G-code list and the statistics table | medium |
| F-15 | §2, §6 | `server/src/routes/api.ts` (565 L) | `apiRouter()` (60–482) holds every route inline, **and** the file exports the validation the MCP layer calls (`validateSliceRequest:510`, `isTransform:506`) – business logic in the route layer, plus `maskPrinter:501` and `appVersion:482`. §6 wants thin routes over services and validation schemas defined once | medium |
| F-16 | §2, §6 | `server/src/jobs.ts` (502 L) | Four responsibilities in one module: the in-memory job queue + SSE (`getJob:102`, `subscribe:110`, `cancelJob:238`), disk persistence (`persist:125`, `loadJobsFromDisk:134`, `pruneJobs:216`), **config merging** (`mergeConfigs:261`) and model storage (`saveModel:163`, `pruneModels:195`) | medium |
| F-17 | §2 | `server/src/mcp/tools.ts:16` | Layer violation: the MCP layer imports the route layer (`listLibrary` from `routes/library.ts`, `validateSliceRequest` from `routes/api.ts`) and `mcp/server.ts:15` imports `appVersion` from `routes/api.ts`; §2 MUST is `mcp → services → slicer/shared`. This is also what makes `routes/api.ts` > `projects.ts` a cycle (F-19) | medium |
| F-18 | §4 | `server/src/slicer/layout.ts` (944 L), `server/src/slicer/threemf.ts` (632 L), `server/src/slicer/schema.ts` (475 L) | `layout.ts` is a ~500-line data table (`LAYOUT_FFF:36`) plus metadata (`KNOWN_OPTIONS:618`) plus four key sets (565–611) in one module; `threemf.ts` is 3MF reader + writer + transform strings + mesh helpers; `schema.ts` mixes the schema type, help parsing and pruning | medium |

### Cycles and structure (medium)

| Id | § | Location | Finding | Sev |
|---|---|---|---|---|
| F-19 | §2 (MUST) | `web/src/importFiles.ts:6` → `web/src/state/store.ts:23`; `server/src/slicer/schema.ts:5` → `server/src/slicer/layout.ts:7`; `server/src/routes/api.ts:36` → `server/src/routes/projects.ts:18` | Three import cycles (madge). In web the store calls `importFiles` (`store.ts:1789` autosave) while `importFiles` drives the store; in the server the schema imports the layout data that imports the schema types, and the projects route imports `validateSliceRequest` from the API route that mounts it | medium |

### Repeated UI patterns (medium/low)

| Id | § | Location | Finding | Sev |
|---|---|---|---|---|
| F-20 | §5 | `web/src/components/OptionField.tsx:52` (int/float), `:76` (single-line text), `:80` (default) | The same controlled-input skeleton (`value={local ?? value}`, `disabled`, `onChange`, `onBlur={commit}`, `onKeyDown` Enter) is written three times (int/float, single-line text, default) – §5 asks for shared numeric/text fields in `components/common/` | medium |
| F-21 | §5 | `web/src/components/Sidebar.tsx:32` (`TransformInputs`) and `:129` (`EXTRUDER_CSS`) ↔ `web/src/three/Viewer.tsx:27` (`EXTRUDER_COLORS`) | The extruder palette is duplicated as numbers (Viewer) and as CSS strings (Sidebar) – they can drift; the same value `0xe6b84a` appears again as the default colour in `web/src/gcode/colorprint.ts:10` and `Viewer.tsx:24` | low |
| F-22 | §4, §5 | `web/src/components/Sidebar.tsx:11` (`fmt`), `web/src/components/dialogs/LibraryDialog.tsx:12` (KB/MB), `web/src/components/PreviewPanel.tsx:134/142` (seconds), `:322` (MB), `server/src/slicer/threemf.ts:186` and `server/src/slicer/gcodeInfo.ts:72` (`parseDuration`) | Number/time/size formatting helpers are re-implemented per call site instead of one `format.ts` per area (§3 constants rule) | low |
| F-23 | §4 | `server/src/routes/api.ts:41`, `server/src/routes/projects.ts:18`, `server/src/routes/library.ts:77`, `server/src/mcp/server.ts:18` | `asyncHandler` (and `badRequest`) copied four times; the route helpers belong in `routes/helpers.ts` | low |

### Dead code, unused exports, naming (low)

| Id | § | Location | Finding | Sev |
|---|---|---|---|---|
| F-24 | §4 | `web/src/state/store.ts:487` (`objectBounds`), `:578` (`geometryToStl` – only used inside the module), `web/src/three/paint.ts:19` (`triangleCount`), `:10` (`PAINT_NONE`), `web/src/api.ts` (13 exported types used only inside the module), `web/src/gcode/colorschemes.ts:64/76`, `web/src/values.ts:4 …` | 39 exports ts-prune reports as module-private or unused; several are genuinely dead (`objectBounds`, `triangleCount`, `PAINT_NONE`) or only published by accident | low |
| F-25 | §3, §4 | `web/src/state/store.ts:34` vs `web/src/api.ts:151` | `VolumeType` is declared in the API contract (`api.ts:151`) and re-listed as the runtime array `VOLUME_TYPES` in `server/src/slicer/threemf.ts:20`, while `store.ts:102` and `Viewer.tsx:30` keep label/colour maps keyed by it – one union, three consumers, no single owner | low |

## Refactoring plan

Rules for every step (§7): behaviour never changes, all tests stay green, new tests pin the behaviour
**before** code moves, one concern per commit, the duplicate is deleted in the commit that introduces
the shared version.

Test baseline before R-1: `npm test` = server 94 tests / 92 pass / 2 pre-existing skips, web 58/58;
`npx tsc -p server/tsconfig.json --noEmit` and `-p web/tsconfig.json --noEmit` green; `npm run build`
green.

**R-1 – `shared/` workspace package (foundation).**
Goal: an empty but working `@webslicer/shared` consumed by web *and* server, so every later step only
moves code. Files: new `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`; root
`package.json` workspaces `+ "shared"`; `web/package.json` + `server/package.json` dependency; web
`vite.config.ts` (workspace resolution) and `web/tsconfig.json` `paths`; Docker build stage. Risk:
medium – build wiring only, no behaviour. Tests first: none (no logic yet); the check is that both
type checks, `npm test` and `npm run build` are green with one trivial exported constant.

**R-2 – API contract types in `shared/src/types`.**
Goal: F-08 and F-09 – declare `PresetType`, `OptionType`, `Mode`, `Config`, `OptionDef`, the layout
triple, `Schema`, `PresetSummary`, `ResolvedPreset`, `PrinterModel`, `Vendor`, `InstalledPrinter`,
`GcodeInfo`, `JobStatus`, `JobRecord`, `JobEvent`, `CustomGcode`, `VolumeType`, `SliceRequest` and the
`Vec3`/`Placement`/`Bounds` base types once; delete the copies in `web/src/api.ts` and the server
modules, re-export the ones the web API client uses. Files: `shared/src/types/*`, `web/src/api.ts`,
`server/src/slicer/{schema,presets,bundles,gcodeInfo}.ts`, `server/src/jobs.ts`. Risk: medium (large
diff, no runtime change – all types erased). Tests first: none needed for erasure; both type checks are
the test. Hint: `Vec3 = [number, number, number]` and `interface Placement` remove five of the
duplicates immediately.

**R-3 – placement/matrix/geometry maths in `shared/src/math`.**
Goal: F-05 and F-06 – one `Matrix4 = number[]` implementation (`IDENTITY`, `translate`, `multiply`,
`apply`, compose/decompose of a placement, mirror, `meshBounds`, `instanceBounds`,
`normalizationOffset`, `normalize`) used by the browser and the headless plater; the browser keeps a
*thin adapter* in `web/src/three/` that converts to/from `THREE.Matrix4` (§2 allows three.js types only
there). Replace `server/src/plater/normalize.ts` and the copies inside `store.ts`/`transform.ts`. Tests
first: port `server/src/plater/*.test.ts` asserts plus new tests for `mirror` (the T-001 sign rule) and
the 3MF round trip `M → string → M` (`transformTo3mf`/`transformFrom3mf`), then delete the server copy.
Risk: **high** – this is the code the guideline blames for past bugs; the tests must exist before the
move.

**R-4 – packing, bed shape, spacing in `shared/src/plater`.**
Goal: F-01, F-02, F-03 – move `packing.ts` and `bedShapeOf`/`arrangementSpacing` to `shared`; the web
and server tests merge into `shared/src/plater/packing.test.ts`; delete `web/src/plater/packing.ts`,
`server/src/plater/packing.ts`, `web/src/plater/packing.test.ts`, `server/src/plater/packing.test.ts`.
Risk: low-medium (pure functions, tests already cover them). Tests first: the two existing suites are
identical – keep one, and add the `toBool('true')` case that only the web copy handled.

**R-5 – PrusaSlicer value codecs and thumbnail specs in `shared`.**
Goal: F-04, F-07 – one implementation of the INI escaping/parsing (`values.ts`) and of
`parseThumbnailSpec`; delete `web/src/values.ts` copies and `server/src/slicer/values.ts`,
`server/src/slicer/thumbnails.ts`'s parser (keep the server's spec-splitting helpers). Risk: low –
pure string functions with existing coverage. Tests first: move the assertions that exist in
`server/src/slicer/values` coverage into `shared`.

**R-6 – store slices.**
Goal: F-11 and the three.js part of F-10 – split `store.ts` into `createPlaterSlice`/`createPresetSlice`/
`createJobSlice`/`createPreviewSlice`/`createUiSlice`/`createHistorySlice` under `web/src/state/slices/`
with a shared `State` type per slice (§5), and move `shellGeometry`/`geometrySize`/`geometryToStl`/
`objectFrameOffset` to `web/src/three/geometry.ts`. Risk: **high** – every component reads the store;
keep the public hook and action names identical so no component changes. Tests first: add a store test
file pinning the actions the browser suite exercises (add/select/arrange/undo/preset switch) before the
move; the browser suite (UAT) is the second net.

**R-7 – Viewer hooks.**
Goal: F-12 – `Viewer.tsx` becomes a composition of `useScene`, `usePlaterObjects`, `useBed`,
`useGcodePreview`, `useCamera`, `usePainting`, `useGizmo`, `useKeyboardShortcuts` (§5), with the
keyboard shortcuts in one table that the handler *and* the About dialog read. Risk: **high** – the
scene lifecycle is order-sensitive (effects create/dispose GPU resources) and the browser suite is the
only end-to-end cover. Tests first: extend the browser suite with the checks the UAT already describes,
then move one effect per commit.

**R-8 – components: common fields and one component per file.**
Goal: F-20, F-13, F-14 – add `components/common/` (`NumericField`/`TextField`/`SectionHeader`/
`ToolbarButton`) and use it in `OptionField` and `TransformInputs`; split `Sidebar.tsx` into
`components/sidebar/*.tsx` and `Dialogs.tsx` into one file per dialog (the `Modal` frame already exists).
Risk: medium – pure UI moves, verify with the browser suite (UAT-05/UAT-09/UAT-14 + screenshots).
Tests first: none at unit level; the UAT suite is the net, so run it before and after.

**R-9 – server services layer.**
Goal: F-15, F-16, F-17 – introduce `server/src/services/` (slice job, projects, library, printers) with
no Express types; `routes/*` become validate → service → respond; `jobs.ts` splits into the job queue,
`jobs/persistence.ts`, `services/configMerge.ts` (F-16) and `services/models.ts`; `mcp/` calls services
instead of routes. Risk: **high** – touches every endpoint; the existing route/MCP tests plus a
`curl`-level smoke run in the dev container are the net. Tests first: move `routes/api.test.ts`
assertions onto the service functions, keeping the HTTP tests as thin wrappers.

**R-10 – validation schemas once (zod).**
Goal: F-15, F-17 – one `validateSliceRequest` (and the project/printers payloads) as a zod schema
shared by REST and MCP (§6), replacing the hand-written `isTransform`/field checks; it also removes the
`api.ts ↔ projects.ts` cycle. Risk: medium – error messages become the schema's; keep the status codes
and message shape identical (the web client shows them). Tests first: keep `routes/api.test.ts` as the
contract test.

**R-11 – server slicer module split.**
Goal: F-18 – `layout.ts` separates the data tables (`layout/*.data.ts` or JSON) from `KNOWN_OPTIONS`
metadata and the key sets; `threemf.ts` splits into `threemf/read.ts`, `threemf/write.ts`,
`threemf/transform.ts` (pure); `schema.ts` keeps only the schema builder. This also resolves the
`schema ↔ layout` cycle (F-19). Risk: medium (move-only, covered by `threemf.test.ts`,
`schema.test.ts`). Tests first: the existing suites are the pin.

**R-12 – cleanup: helpers, formatting, dead code, constants.**
Goal: F-21, F-22, F-23, F-24, F-25 – one `format.ts` per side (time/length/bytes/percent), one extruder
palette constant in `shared`, `routes/helpers.ts` for `asyncHandler`/`badRequest`, delete everything
ts-prune reports as unused, and give `VolumeType` a single owner with the label/colour maps next to it.
Risk: low. Tests first: add a small unit test for each formatting helper before the call sites switch.

## Open questions for the lead

1. **Where does `shared/` build from?** Vite can consume TS sources directly, the server compiles with
   `tsc` to `dist` – the R-1 wiring has to decide whether `shared` ships compiled `dist` (Docker copies
   it) or sources (server `tsconfig` includes it). I recommend compiled `dist` with `composite: true`,
   so `npm run build -w shared` fits the existing Docker stages.
2. **`three` in `shared`?** The plan keeps `shared` three-free (plain `number[]`), which forces the thin
   adapters in `web/src/three/` and makes R-3 slightly larger; the alternative (allow `three` in
   `shared`) would make the migration shorter but put a renderer dependency inside the server build. I
   recommend the three-free version, as the guideline demands.
3. **Order of R-6/R-7 vs R-9.** Both risk groups touch the browser; the store split (R-6) should land
   before the Viewer hooks (R-7), and the server work (R-9 … R-11) can run in parallel to R-8 if
   wanted.
