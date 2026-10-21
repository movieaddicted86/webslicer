# WebSlicer – Engineering conventions for contributors (human or LLM)

These rules apply to every work package in this folder. Code structure, types and clean-code rules
are in [CODING-GUIDELINES.md](CODING-GUIDELINES.md) – binding as well. Read them completely before you write code.
If a work package contradicts this file, the work package wins for that package only.

## 1. Project in one paragraph

WebSlicer is PrusaSlicer in the browser. The **server** (`server/`, Node 22, Express, TypeScript, ESM)
wraps the PrusaSlicer 2.9 CLI: it builds a PrusaSlicer-style 3MF from the plater, runs
`--export-gcode`, streams job progress over SSE and serves presets, library files and print hosts.
The **web app** (`web/`, React 18, Zustand, three.js, Vite) is the plater, settings editor and
G-code preview. Target behaviour, labels and file formats follow **PrusaSlicer 2.9** – when in
doubt, do what PrusaSlicer does and name it the way PrusaSlicer names it.

```
shared/src/types/             API contract types (SliceRequest, JobRecord, Config, …) – declared once
shared/src/math/              Matrix4 helpers, placement compose/decompose, bounds, mirror
shared/src/plater/            packing, normalisation, split, bed shape, spacing
shared/src/values.ts          preset value codecs and their limits
server/src/routes/api.ts      REST API, request validation (validateSliceRequest)
server/src/jobs.ts            slice job queue, SliceRequest → 3MF → CLI
server/src/slicer/threemf.ts  3MF writer/reader (PrusaSlicer extensions) + tests
web/src/state/store.ts        composes `useStore` from the slice creators and re-exports them
web/src/state/slices/         one slice per area: plater, preset, job, preview, ui, history, paint, ranges
web/src/three/Viewer.tsx      composition of the `three/viewer/` hooks, no logic of its own
web/src/three/viewer/         scene, bed, camera, plater objects, gizmo, G-code preview, shortcuts.ts
web/src/components/sidebar/   object list, manipulation, volumes, slice panel
web/src/components/common/    SectionHeader, TextField, NumericField, ToolbarButton, useFieldDraft
web/src/components/dialogs/   one file per dialog on the shared Modal frame
web/src/components/preview/   preview panel parts (layer slider, codes, options, legend)
web/src/api.ts                web-side API client; its types come from `@webslicer/shared`
web/src/importFiles.ts        model/3MF import (also used by autosave restore)
docs/                         Feature-Comparison (parity matrix), UAT, UAT-Report, concepts
```

## 2. Language

- Everything in the repository is **English**: code, comments, UI texts, docs, commit messages.
- Robert (product owner) writes in German; answer him in German in chat if you talk to him.

## 3. Toolchain and commands

| Purpose                            | Command (repo root)                                                    |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Install                            | `npm ci`                                                               |
| Type check shared                  | `npm run typecheck -w shared`                                          |
| Type check web                     | `npm run typecheck -w web`                                             |
| Type check server                  | `npm run typecheck -w server`                                          |
| Unit tests, all three workspaces   | `npm test` (node:test via tsx)                                         |
| Unit tests, one workspace          | `npm test -w shared` · `-w server` · `-w web`                          |
| Build shared                       | `npm run build -w shared`                                              |
| Full build                         | `npm run build`                                                        |
| Run everything (incl. PrusaSlicer) | `docker compose up -d --build` → http://localhost:8080                 |
| Web dev server                     | `npm run dev -w web` → http://localhost:5173 (proxies `/api` to :8080) |
| Shell scripts                      | `shellcheck -S warning proxmox/*.sh`                                   |

`shared` is built first: the other two workspaces import it from `shared/dist`. Test files are
`*.test.ts` next to the code they cover, colocated in all three workspaces (`npm test` globs
`src/**/*.test.ts`). **Quote such a glob** – `sh` has no globstar and would silently drop the
top-level files (Docker and CI run the scripts with `/bin/sh`); Node expands the quoted pattern.

The server needs the PrusaSlicer binary, so for UI work run the server in Docker and the web app
with Vite. The dev machine is Windows 11 with Git Bash/PowerShell: set `MSYS_NO_PATHCONV=1` for
`docker run -v` paths and do not pass TypeScript through Bash heredocs (write files instead).

## 4. Code style

- TypeScript `strict`; no `any` (use `unknown` + narrowing). No `// @ts-ignore`.
- Formatting like the existing code: 2 spaces, single quotes, semicolons, trailing commas, lines up
  to ~140 characters. Do not reformat code you do not change.
- Server imports use ESM with `.js` suffix (`from './slicer/threemf.js'`).
- Comments: short JSDoc one-liners on exported functions/types and comments that explain _why_.
  No commented-out code, no TODO without an entry in `TODO.md`.
- **No new runtime dependencies** without approval of the lead developer. Dev dependencies only if
  the work package allows it.
- Keep functions pure where possible (geometry, parsing, packing) so they can be unit tested.

### Web specifics

- State lives in the Zustand store: `web/src/state/store.ts` composes `useStore` from the slice
  creators in `web/src/state/slices/` (one file per area) and re-exports the domain types, so
  components keep importing from `state/store`. Components read with selectors
  (`useStore((s) => s.objects)`), never mutate state directly, and call store actions.
- Every user-visible plater change: call `get().recordHistory()` **before** the change (undo/redo)
  and set `sliceDirty: true`.
- IDs are strings with a prefix and a module counter (`obj-12`, `vol-3`, `rng-4`). Follow that
  pattern for new entity types.
- three.js: share `BufferGeometry` between meshes that show the same mesh; dispose geometries and
  materials you created when objects are removed.
- UI: PrusaSlicer wording; tooltips name the shortcut in parentheses (`title="Arrange (A)"`).
  A new shortcut goes into the `SHORTCUTS` table in `three/viewer/shortcuts.ts` **only**: the key
  handler (`three/viewer/useKeyboardShortcuts.ts`) and the shortcut line of the About dialog read
  that table, so there is nothing else to update. Respect the mode switch (Simple hides the object
  list).
- The store is exposed as `window.webslicer` for debugging and scripted browser checks.

### Server specifics

- Every request body is validated in `routes/api.ts` before use (types, lengths, limits). Reject
  invalid input with a clear message; never trust the client.
- Types shared with the web app live in `shared/src/types` and are declared **once** there.
  `web/src/api.ts` re-exports them, so `import { type SliceRequest } from './api'` keeps working;
  nothing is declared a second time on the web side.
- 3MF output must stay loadable by **desktop PrusaSlicer** and must roundtrip through
  `read3mfProject`. Any change to `threemf.ts` needs a roundtrip test.

## 5. Testing – definition of done

A work package (and each phase of it) is done only when all of this holds:

1. Both type checks pass, `npm test` passes, `npm run build` passes.
2. New pure logic has unit tests (server: `*.test.ts` next to the code, `node:test` + `assert`).
3. The feature was exercised in a real browser against a real slice (Docker server), including
   the acceptance criteria of the work package. Record what you checked and the observed result.
4. No errors in the browser console (except the known 404 of `/api/autosave/...?info` when no
   autosave exists).
5. Regression smoke test of the touched areas (see the work package), at least UAT-04, 05, 06,
   12 and 13 from `docs/UAT.md`.
6. Docs updated: `CHANGELOG.md` (Unreleased), `TODO.md` checkbox, `docs/Feature-Comparison.md`
   row, a new UAT case in `docs/UAT.md` for user-visible features, README only if setup changes.

## 6. Git

- Work on a branch `feature/<package-id>` (e.g. `feature/p1.3-instances`), one commit per phase.
- Commit message: `<Area>: <imperative summary> (<package id>)`, blank line, bullet body wrapped
  at ~72 characters, and a `Co-Authored-By:` trailer that names the model that wrote the code.
- Push the branch. **Do not merge into `main`** – the lead developer reviews and merges.
- Never commit secrets, API keys, local data (`data/`, `library/`) or editor/tool settings.

## 7. Scope discipline

- Change only what the work package needs. Unrelated findings go into the handover report.
- Do not touch `proxmox/`, `Dockerfile` or CI unless the package says so.
- If a binding design decision in the package turns out to be wrong, stop and describe the problem
  and your proposal in the handover report instead of silently deviating.

## 8. Handover report

Finish with a short report (Markdown, in the PR/branch description or chat):

- What was implemented, per phase, with commit hashes.
- Test evidence: commands and their result, browser checks with observed values.
- Deviations from the package and why; open points and known limitations.
