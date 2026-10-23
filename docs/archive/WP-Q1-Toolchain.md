# Work package Q1 – Toolchain unblock

|            |                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q1-toolchain` (branch `feature/q1-toolchain`)                                                                                                                                                                                                                                                                  |
| Findings   | A3, A7, W7 (rest), W9                                                                                                                                                                                                                                                                                           |
| Base       | `main` at commit `eb00fa4` or later                                                                                                                                                                                                                                                                             |
| Read first | CONVENTIONS.md, CODING-GUIDELINES.md, this file                                                                                                                                                                                                                                                                 |
| Estimate   | 3 phases, one commit each                                                                                                                                                                                                                                                                                       |
| Allowed    | all `tsconfig*.json` (incl. `e2e/tsconfig.json`, new `tsconfig.build.json` files), build scripts in `package.json`, `eslint.config.mjs`, all `package.json`, `package-lock.json`, `.github/dependabot.yml`, `web/vite.config.ts`, `TODO.md`, `README.md` (Node badge only), CONVENTIONS.md §3/§4 (lint wording) |

## 1. Goal

Framework updates become routine Dependabot merges. Today three things block them: `baseUrl` in
`web/tsconfig.json` (deprecated in TypeScript 6, removed in 7), an ESLint config that relies on
deprecated helpers and a phantom dependency, and Dependabot PRs that split packages which must move
together (Vite + plugin-react, three + @types/three).

## 2. Acceptance criteria

- AC-1 `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run e2e:docker` pass
  with **TypeScript 6** and **Vite 8 + @vitejs/plugin-react 6**.
- AC-2 No `baseUrl` in any tsconfig. Every tsconfig that compiles tests sets `types` explicitly.
- AC-3 `eslint.config.mjs` uses `defineConfig` (from `eslint/config`) and
  `parserOptions.projectService: true`; `@eslint/js` is a declared devDependency at the root.
- AC-4 `.github/dependabot.yml` groups: `three` + `@types/three`; `react` + `react-dom` +
  `@types/react` + `@types/react-dom`; `vite` + `@vitejs/plugin-react`; `typescript` alone;
  `eslint*` + `typescript-eslint` + `@eslint/js`. These groups include `major` updates and are
  listed **before** the existing minor/patch group, otherwise that group catches the updates first.
- AC-5 Lint output (number of warnings per rule) is the same as on `eb00fa4` or lower.

## 3. Binding decisions

- **Do not adopt TypeScript 7 in this package.** TS 7 (native) has no JavaScript API, so
  typescript-eslint's type-aware rules cannot run on it yet. Pin `typescript` to `~6.x` and add a
  `TODO.md` entry: "Adopt TS 7 once typescript-eslint supports it; until then `tsgo` may be tried
  for `typecheck` only".
- Delete `baseUrl` from `web/tsconfig.json` and `e2e/tsconfig.json`; keep `paths` (they are already
  relative and, like the Vite alias, point to `../shared/src/index.ts`). Do not switch `web` to the
  package `exports` of `shared` – those point to `dist`.
- `web` and `shared` get `@types/node` as a devDependency (today it only resolves through hoisting).
- Keep `tseslint.configs.recommended` as the rule base (switching to `recommendedTypeChecked` is
  out of scope; it would produce a large unrelated diff). Keep `no-floating-promises: error`.
- Node stays at 22 in this package (engines, Dockerfile, CI). Only fix the README badge (`≥20` → `≥22`).

## 4. Phases

### Phase 0 – Baseline

- Run all commands from AC-1 on `eb00fa4`. Record: lint warnings per rule, `npm run build` time,
  web bundle size from the Vite output. No commit.

### Phase 1 – ESLint config and Dependabot groups

- `eslint.config.mjs`: `defineConfig`, `projectService: true` (remove `parserOptions.project`
  lists), `@eslint/js` added to root devDependencies.
- `projectService` needs a tsconfig that **includes** the test files. `server/tsconfig.json` and
  `shared/tsconfig.json` exclude `*.test.ts` today: make each workspace's `tsconfig.json` include
  tests and move the emit settings to `tsconfig.build.json` (update the `build` scripts), otherwise
  lint fails on every test file.
- `.github/dependabot.yml`: groups from AC-4; keep the weekly schedule.
- Check: `npm run lint` → same warnings as Phase 0 (AC-5).
- Commit: `Tooling: flat ESLint config with projectService, grouped Dependabot updates (q1-toolchain)`

### Phase 2 – TypeScript 6

- Bump `typescript` to the latest 6.x in every workspace. Remove `baseUrl` from `web/tsconfig.json`
  and `e2e/tsconfig.json` (decision 3.2). Set
  `types` in every tsconfig that compiles tests (`["node"]`), because TS 6 defaults `types` to `[]`.
- Fix new errors without `@ts-ignore` and without loosening `strict`.
- Check: AC-1 with Vite 7 still in place.
- Commit: `Tooling: TypeScript 6, no baseUrl (q1-toolchain)`

### Phase 3 – Vite 8 and plugin-react 6

- Bump both together. Port `web/vite.config.ts` only where Vite 8 (Rolldown) requires it.
- Check: AC-1; compare the bundle size with Phase 0 and report it; open the app in the browser,
  import the calibration cube, slice, open the preview – no console errors (CONVENTIONS §5.4).
- Commit: `Tooling: Vite 8 and plugin-react 6 (q1-toolchain)`

## 5. Pitfalls

- `web` reads `shared` from source, `server` from `shared/dist`. Do not change that in this package;
  just make sure both still resolve after removing `baseUrl`.
- The node:test files in `web/` need Node types; without `types: ["node"]` TS 6 reports `describe`
  / `assert` as missing.
- Close the open Dependabot PRs that this package supersedes in the handover note (list their
  numbers); do not merge them separately.

## 6. Review checklist

- [ ] No `baseUrl`; Vite alias and tsconfig resolve `shared` the same way.
- [ ] Lint warnings per rule ≤ baseline; `no-floating-promises` still an error.
- [ ] Dependabot groups as in AC-4.
- [ ] TS 7 explicitly deferred with a `TODO.md` entry.
- [ ] Bundle size before/after in the handover.
