# Project structure

Part of [CONVENTIONS.md](../CONVENTIONS.md) §1.

```
shared/src/types/             API contract types (SliceRequest, JobRecord, Config, …) – declared once
shared/src/math/              Matrix4 helpers, placement compose/decompose, bounds, mirror
shared/src/plater/            packing, normalisation, split, bed shape, spacing
shared/src/values.ts          preset value codecs and their limits
server/src/routes/           one router per resource (meta, presets, models, jobs, printers, exports,
                             autosave, library, projects); validate → call one service → respond
server/src/services/         use cases (slice, jobs, presets, printers, exports, autosave, library,
                             projects) – no Express types; routes and MCP call these, never each other
server/src/storage/          atomic JSON stores (jsonStore) shared by the server-side stores
server/src/validation/        one zod schema per request payload, shared by REST and MCP
server/src/jobs.ts            slice job queue, SliceRequest → 3MF → CLI
server/src/slicer/threemf/    3MF writer/reader (PrusaSlicer extensions) + tests
web/src/state/store.ts        composes `useStore` from the slice creators and re-exports them
web/src/state/slices/         one slice per area (preset, job, preview, ui, history, tools); the plater
                              slice is composed in plater.ts from paint, ranges, cut, profile, objects,
                              volumes, instances, transform, split and merge
web/src/state/upload.ts       the one mesh upload path (binary STL, uploadError bookkeeping, toast)
web/src/plater/               plater logic without three.js: packing, bounds, split, the mesh readers
                              (meshInfo), paint codecs; meshOps is the one seam into three/
web/src/three/Viewer.tsx      composition of the `three/viewer/` hooks, no logic of its own
web/src/three/viewer/         scene, bed, cameraMath, plater objects, gizmo, G-code preview, shortcuts.ts
web/src/components/left/      the left column: its cards, the object rows, the toolbar, the fold/resize state hook
web/src/components/context/   the right context panel: its frame and cards, the preset rows, quick settings,
                              slice panel, volumes and ranges, the destination row
web/src/components/common/    SectionHeader, TextField, NumericField, ToolbarButton, useFieldDraft, InlineName
web/src/components/dialogs/   one file per dialog on the shared Modal frame
web/src/components/preview/   preview panel parts (layer slider, codes, options, legend)
web/src/api.ts                web-side API client; its types come from `@webslicer/shared`
web/src/importFiles.ts        model/3MF import (also used by autosave restore)
docs/                         Feature-Comparison (parity matrix), UAT, concepts; archive/ holds
                              finished reports and work packages
```
