# WebSlicer – Engineering conventions for contributors (human or LLM)

These rules apply to every work package in this folder. Code structure, types and clean-code rules
are in [CODING-GUIDELINES.md](CODING-GUIDELINES.md) – binding as well. Read this core, then only the
appendix the work package names.
If a work package contradicts this file, the work package wins for that package only.

## 1. Project in one paragraph

WebSlicer is PrusaSlicer in the browser. The **server** (`server/`, Node 22, Express, TypeScript, ESM)
wraps the PrusaSlicer 2.9 CLI: it builds a PrusaSlicer-style 3MF from the plater, runs
`--export-gcode`, streams job progress over SSE and serves presets, library files and print hosts.
The **web app** (`web/`, React 19, Zustand, three.js, Vite 8) is the plater, settings editor and
G-code preview. Target behaviour, labels and file formats follow **PrusaSlicer 2.9** – when in
doubt, do what PrusaSlicer does and name it the way PrusaSlicer names it.

The file map is in [conventions/structure.md](conventions/structure.md).

## 2. Language

- Everything in the repository is **English**: code, comments, UI texts, docs, commit messages.
- Robert (product owner) writes in German; answer him in German in chat if you talk to him.

## 3. Toolchain and commands

Install with `npm ci`; build `shared` first (`npm run build -w shared`), then type check, test and
lint per workspace. The command table, the quoted test glob (`--test-reporter=dot` goes **before**
the glob) and the CI steps are in [conventions/toolchain.md](conventions/toolchain.md).

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

Web rules (store, CSS, three.js boundary, shortcuts, UI wording): [conventions/web.md](conventions/web.md).
Server rules (validation, shared types, 3MF roundtrip): [conventions/server.md](conventions/server.md).

## 5. Testing – definition of done and behaviour-preserving first

1. During a phase test only the test file next to the changed module, with `--test-reporter=dot` (one
   case: add `--test-name-pattern`).
2. Check only the touched workspace: `npm run typecheck -w <workspace>`, `npx eslint --quiet <files>`;
   after a change in `shared` first `npm run build -w shared`.
3. The full run exactly once, before the hand-back: `npm run typecheck`, `npm run lint:errors`,
   `npm run format:check`, `npm test`.
4. E2E: only the specs the task names (`npm run e2e:docker -- <spec>.spec.ts`); the full suite is CI's.
5. Format with the tool: `npx prettier --write <changed files>`, never by hand, never repo-wide.
6. Do not read unless the task names it: `docs/archive/`, `CHANGELOG.md`, `docs/development.md`,
   `e2e/`, fixtures, `*.data.ts`.
7. No command output in the hand-back; "AC-3: pass" is enough, on a failure the one relevant assertion.

The full definition of done, the E2E hook list and the docs rules (changelog, short README) are in
[conventions/testing.md](conventions/testing.md), [conventions/e2e.md](conventions/e2e.md) and
[conventions/docs.md](conventions/docs.md).

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
