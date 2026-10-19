# WebSlicer – Engineering conventions for contributors (human or LLM)

These rules apply to every work package in this folder. Read them completely before you write code.
If a work package contradicts this file, the work package wins for that package only.

## 1. Project in one paragraph

WebSlicer is PrusaSlicer in the browser. The **server** (`server/`, Node 22, Express, TypeScript, ESM)
wraps the PrusaSlicer 2.9 CLI: it builds a PrusaSlicer-style 3MF from the plater, runs
`--export-gcode`, streams job progress over SSE and serves presets, library files and print hosts.
The **web app** (`web/`, React 18, Zustand, three.js, Vite) is the plater, settings editor and
G-code preview. Target behaviour, labels and file formats follow **PrusaSlicer 2.9** – when in
doubt, do what PrusaSlicer does and name it the way PrusaSlicer names it.

```
server/src/routes/api.ts      REST API, request validation (validateSliceRequest)
server/src/jobs.ts            slice job queue, SliceRequest → 3MF → CLI
server/src/slicer/threemf.ts  3MF writer/reader (PrusaSlicer extensions) + tests
web/src/state/store.ts        the single Zustand store: plater, presets, jobs, history
web/src/three/Viewer.tsx      3D scene, picking, gizmo, keyboard shortcuts, G-code rendering
web/src/components/           Sidebar (object list, manipulation), PreviewPanel, dialogs
web/src/api.ts                web-side API client and the *mirrored* server types
web/src/importFiles.ts        model/3MF import (also used by autosave restore)
docs/                         Feature-Comparison (parity matrix), UAT, UAT-Report, concepts
```

## 2. Language

- Everything in the repository is **English**: code, comments, UI texts, docs, commit messages.
- Robert (product owner) writes in German; answer him in German in chat if you talk to him.

## 3. Toolchain and commands

| Purpose | Command (repo root) |
|---|---|
| Install | `npm ci` |
| Type check web | `npx --prefix web tsc -p web --noEmit` |
| Type check server | `npx --prefix server tsc -p server --noEmit` |
| Server unit tests | `npm test` (node:test via tsx, files `server/src/**/*.test.ts`) |
| Full build | `npm run build` |
| Run everything (incl. PrusaSlicer) | `docker compose up -d --build` → http://localhost:8080 |
| Web dev server | `npm run dev -w web` → http://localhost:5173 (proxies `/api` to :8080) |
| Shell scripts | `shellcheck -S warning proxmox/*.sh` |

The server needs the PrusaSlicer binary, so for UI work run the server in Docker and the web app
with Vite. The dev machine is Windows 11 with Git Bash/PowerShell: set `MSYS_NO_PATHCONV=1` for
`docker run -v` paths and do not pass TypeScript through Bash heredocs (write files instead).

## 4. Code style

- TypeScript `strict`; no `any` (use `unknown` + narrowing). No `// @ts-ignore`.
- Formatting like the existing code: 2 spaces, single quotes, semicolons, trailing commas, lines up
  to ~140 characters. Do not reformat code you do not change.
- Server imports use ESM with `.js` suffix (`from './slicer/threemf.js'`).
- Comments: short JSDoc one-liners on exported functions/types and comments that explain *why*.
  No commented-out code, no TODO without an entry in `TODO.md`.
- **No new runtime dependencies** without approval of the lead developer. Dev dependencies only if
  the work package allows it.
- Keep functions pure where possible (geometry, parsing, packing) so they can be unit tested.

### Web specifics

- State lives in `web/src/state/store.ts`. Components read with selectors
  (`useStore((s) => s.objects)`), never mutate state directly, and call store actions.
- Every user-visible plater change: call `get().recordHistory()` **before** the change (undo/redo)
  and set `sliceDirty: true`.
- IDs are strings with a prefix and a module counter (`obj-12`, `vol-3`, `rng-4`). Follow that
  pattern for new entity types.
- three.js: share `BufferGeometry` between meshes that show the same mesh; dispose geometries and
  materials you created when objects are removed.
- UI: PrusaSlicer wording; tooltips name the shortcut in parentheses (`title="Arrange (A)"`);
  new shortcuts go into the keyboard handler in `Viewer.tsx` *and* the shortcut line in
  `components/dialogs/Dialogs.tsx`. Respect the mode switch (Simple hides the object list).
- The store is exposed as `window.webslicer` for debugging and scripted browser checks.

### Server specifics

- Every request body is validated in `routes/api.ts` before use (types, lengths, limits). Reject
  invalid input with a clear message; never trust the client.
- Types shared with the web app are mirrored in `web/src/api.ts` – change both together.
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
