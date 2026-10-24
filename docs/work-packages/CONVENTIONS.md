# WebSlicer – Engineering conventions for contributors (human or LLM)

These rules apply to every work package in this folder. Code structure, types and clean-code rules
are in [CODING-GUIDELINES.md](CODING-GUIDELINES.md) – binding as well. Read them completely before you write code.
If a work package contradicts this file, the work package wins for that package only.

## 1. Project in one paragraph

WebSlicer is PrusaSlicer in the browser. The **server** (`server/`, Node 22, Express, TypeScript, ESM)
wraps the PrusaSlicer 2.9 CLI: it builds a PrusaSlicer-style 3MF from the plater, runs
`--export-gcode`, streams job progress over SSE and serves presets, library files and print hosts.
The **web app** (`web/`, React 19, Zustand, three.js, Vite 8) is the plater, settings editor and
G-code preview. Target behaviour, labels and file formats follow **PrusaSlicer 2.9** – when in
doubt, do what PrusaSlicer does and name it the way PrusaSlicer names it.

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
web/src/components/sidebar/   object list, manipulation, volumes, slice panel
web/src/components/common/    SectionHeader, TextField, NumericField, ToolbarButton, useFieldDraft
web/src/components/dialogs/   one file per dialog on the shared Modal frame
web/src/components/preview/   preview panel parts (layer slider, codes, options, legend)
web/src/api.ts                web-side API client; its types come from `@webslicer/shared`
web/src/importFiles.ts        model/3MF import (also used by autosave restore)
docs/                         Feature-Comparison (parity matrix), UAT, concepts; archive/ holds
                              finished reports and work packages
```

## 2. Language

- Everything in the repository is **English**: code, comments, UI texts, docs, commit messages.
- Robert (product owner) writes in German; answer him in German in chat if you talk to him.

## 3. Toolchain and commands

| Purpose                            | Command (repo root)                                                     |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Install                            | `npm ci`                                                                |
| Type check shared                  | `npm run typecheck -w shared`                                           |
| Type check web                     | `npm run typecheck -w web`                                              |
| Type check server (incl. tests)    | `npm run typecheck -w server` (`tsconfig.test.json` covers `*.test.ts`) |
| Unit tests, all three workspaces   | `npm test` (node:test via tsx)                                          |
| Unit tests, one workspace          | `npm test -w shared` · `-w server` · `-w web`                           |
| Build shared                       | `npm run build -w shared`                                               |
| Full build                         | `npm run build`                                                         |
| Lint (ESLint 9, all workspaces)    | `npm run lint`                                                          |
| Format / check formatting          | `npm run format` · `npm run format:check` (Prettier)                    |
| Run everything (incl. PrusaSlicer) | `docker compose up -d --build` → http://localhost:8080                  |
| Web dev server                     | `npm run dev -w web` → http://localhost:5173 (proxies `/api` to :8080)  |
| Shell scripts                      | `shellcheck -S warning proxmox/*.sh`                                    |

`shared` is built first: the other two workspaces import it from `shared/dist`. Test files are
`*.test.ts` next to the code they cover, colocated in all three workspaces (`npm test` globs
`src/**/*.test.ts`). **Quote such a glob** – `sh` has no globstar and would silently drop the
top-level files (Docker and CI run the scripts with `/bin/sh`); Node expands the quoted pattern.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci` → `npm run typecheck`
(the server step also type checks its test files) → `npm run lint` → `npm run format:check` → `npm test`
→ `npm run build`. Its token is read-only (`permissions: contents: read`); dependency updates arrive
through Dependabot (`.github/dependabot.yml`). Lint and formatting are
part of the definition of done, so run both before you push.

The server needs the PrusaSlicer binary, so for UI work run the server in Docker and the web app
with Vite. The dev machine is Windows 11 with Git Bash/PowerShell: set `MSYS_NO_PATHCONV=1` for
`docker run -v` paths and do not pass TypeScript through Bash heredocs (write files instead).

## 4. Code style

- TypeScript `strict`; no `any` (use `unknown` + narrowing). No `// @ts-ignore`.
- Formatting is enforced by Prettier (`.prettierrc.json`): 2 spaces, single quotes, semicolons,
  trailing commas, lines up to 140 characters. Run `npm run format` before you commit; do not
  hand-format. `endOfLine` is `auto`, not `lf`: `.gitattributes` stores LF and `core.autocrlf=true`
  checks out CRLF on Windows, so `lf` would make `format:check` fail on every Windows checkout.
- ESLint 9 (`eslint.config.mjs`) is the arbiter for code smells: `typescript-eslint` recommended,
  type-aware (`parserOptions.projectService`, W7) with `no-floating-promises` as an error, `react-hooks` for
  `web/`, `no-explicit-any` as an error. A promise you mean to start and not await is written `void f()`
  with the reason; a plain `.mjs` file is linted without types. `no-non-null-assertion` is a warning
  until R-12 removes the remaining ones. A disable comment needs a `-- <reason>` and must sit on the
  line the rule reports; prefer fixing the code.
- Server imports use ESM with `.js` suffix (`from './slicer/threemf.js'`).
- Comments: short JSDoc one-liners on exported functions/types and comments that explain _why_.
  No commented-out code, no TODO without an entry in `TODO.md`. **No ticket ids in code comments** –
  the commit message carries the id; an existing comment is not rewritten for this alone.
- **No new runtime dependencies** without approval of the lead developer. Dev dependencies only if
  the work package allows it.
- Keep functions pure where possible (geometry, parsing, packing) so they can be unit tested.

### Web specifics

- State lives in the Zustand store: `web/src/state/store.ts` composes `useStore` from the slice
  creators in `web/src/state/slices/` (one file per area) and re-exports the domain types, so
  components keep importing from `state/store`. Components read with selectors
  (`useStore((s) => s.objects)`), never mutate state directly, and call store actions.
- Component styles live in a plain `*.css` file next to the component (`ObjectRow.css`) and are
  imported for their side effect; selectors stay global (the classes are still the styling handle
  and the DOM outline prints them, even though the E2E specs select by hooks). Not CSS Modules: Vite 8 tree-shakes a `*.module.css` import whose class map is unused, so a
  component would silently lose its styles in the production build. Tokens, the reset, form
  controls and the app frame live in `web/src/styles.css`, which `main.tsx` imports **before** the
  app so the element-level rules lose against the component sheets.
- Every user-visible plater change: call `get().recordHistory()` **before** the change (undo/redo)
  and set `sliceDirty: true`.
- IDs are strings with a prefix and a module counter (`obj-12`, `vol-3`, `rng-4`). Follow that
  pattern for new entity types.
- three.js: imports of the `three` package and `three/examples/**` live in `web/src/three/**` only
  (ESLint enforces it); `state/types.ts` may `import type` it for the geometry type, and tests may
  build fixtures with it. `state/**` never imports a `three/**` module at runtime – store actions
  reach three.js through `plater/meshOps`, and pure logic goes to `plater/`. The viewer may import
  `state/store` (it reads the store), not the other way round.
- three.js: share `BufferGeometry` between meshes that show the same mesh; dispose geometries and
  materials you created when objects are removed.
- UI: PrusaSlicer wording; tooltips name the shortcut in parentheses (`title="Arrange (A)"`).
  A new shortcut goes into the `SHORTCUTS` table in `three/viewer/shortcuts.ts` **only**: the key
  handler (`three/viewer/useKeyboardShortcuts.ts`) and the shortcut line of the About dialog read
  that table, so there is nothing else to update. Respect the mode switch (Simple hides the object
  list).
- The store is exposed as `window.webslicer` for debugging and scripted browser checks.

### Server specifics

- Every request body is validated against the schema of its payload in `server/src/validation/`
  before use (types, lengths, limits) – the same schema the MCP tools declare to their clients.
  Reject invalid input with a clear message; never trust the client.
- Types shared with the web app live in `shared/src/types` and are declared **once** there.
  `web/src/api.ts` re-exports them, so `import { type SliceRequest } from './api'` keeps working;
  nothing is declared a second time on the web side.
- 3MF output must stay loadable by **desktop PrusaSlicer** and must roundtrip through
  `read3mfProject`. Any change to `threemf/` needs a roundtrip test.

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

### E2E selectors: hooks, not structure

The layout work moves the sidebar, the tool bar, the top bar and the preview controls between
regions. A spec that encodes _where_ an element sits (`.sidebar .quick-settings`,
`.tool-bar button:nth-child(2)`, a descendant chain through a container) breaks on every move.

- Structural elements carry a `data-testid` hook named by **role, not place**: `app-shell`,
  `top-bar`, `sidebar`, `presets`, `preset-select-<type>`, `object-list`, `object-toolbar`,
  `object-row` (plus `data-object-id`), `object-info`, `quick-settings`, `slice-panel`,
  `slice-button`, `tool-bar`, `tool-<toolId>`, `tool-panel` (+ `-title`, `-foot`, `-close`),
  `modal` (+ `-title`, `-actions`, `-primary`, `-close`, `-backdrop`), `preview-panel`,
  `layer-slider`, `move-slider`, `legend`, `sliced-info`, `send-button`, `toast`. A hook must stay
  correct when the element moves to another region; add one when the region changes, not when a
  class is convenient.
- Specs locate these with the hook, never with the structural class: `byId(page, 'tool-panel')`
  from `e2e/helpers/hooks.ts` (or `[data-testid="tool-panel"]` inside a `page.evaluate`).
  `playwright.config.ts` sets `testIdAttribute: 'data-testid'` explicitly so `getByTestId` cannot
  drift from the app.
- Locators that do **not** depend on position stay as they are: field labels, button texts, ARIA
  roles, `title` tooltips and the element's own visual state classes (`.selected`, `.outside`,
  `.primary`).
- `e2e/hooks.test.ts` (run by `npm test`) fails when a spec uses `.sidebar`, `.tool-bar`,
  `.tool-panel`, `.object-row`, `.slice-panel`, `.quick-settings`, `.presets`, `.objects` or
  `.modal` as a selector, and when one of the hooks above disappears from the components. An
  exception goes into its allow-list with a reason, and it has to keep occurring.
- Hooks are additive: the class names stay (CSS and the DOM outline use them), and the production
  build keeps the attributes – stripping them would make the E2E build differ from the shipped one.

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
