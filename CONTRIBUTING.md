# Contributing

Thanks for your interest in WebSlicer. Bug reports and pull requests are welcome.

## Read first

Three documents are binding for every change – read them before you write code:

- [docs/work-packages/CONVENTIONS.md](docs/work-packages/CONVENTIONS.md) – language, toolchain,
  code style, definition of done, git rules, handover report.
- [docs/work-packages/CODING-GUIDELINES.md](docs/work-packages/CODING-GUIDELINES.md) – structure,
  types, clean-code rules.
- [docs/development.md](docs/development.md) – repository layout, API excerpt, the E2E suite in
  detail.

Larger changes are planned as work packages in [docs/work-packages/](docs/work-packages/); each one
names its phases, the allowed files and the acceptance criteria.

## Setup

Node.js **22 or newer** and npm. The server needs the PrusaSlicer CLI (2.9.x); the dev machine can
reach it through Docker, which is also what the E2E suite uses.

```bash
npm ci
npm run dev        # shared build, then Vite on :5173 (proxy → API) + server on :8080
```

All repository texts – code, comments, UI, docs, commits – are **English**.

## Commands

| Purpose                          | Command (repo root)                              |
| -------------------------------- | ------------------------------------------------ |
| Type check (all workspaces)      | `npm run typecheck`                              |
| Unit tests (all workspaces)      | `npm test`                                       |
| One workspace                    | `npm test -w web` · `-w server` · `-w shared`    |
| Lint (ESLint 9)                  | `npm run lint`                                   |
| Format / check                   | `npm run format` · `npm run format:check`        |
| Build                            | `npm run build`                                  |
| Run the full stack (Docker)      | `docker compose up -d --build` → :8080           |
| E2E suite (Docker, real app)     | `npm run e2e:docker`                             |
| One E2E spec                     | `npm run e2e:docker -- viewer.spec.ts`           |
| E2E against a running app        | `E2E_BASE_URL=http://localhost:8081 npm run e2e` |
| Refresh the documentation images | `npm run docs:screenshots`                       |
| Shell scripts                    | `shellcheck -S warning proxmox/*.sh`             |

`npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` and `npm run build` are what
CI runs, so they must pass before you push. On Windows use Git Bash/PowerShell and do not pass
TypeScript through bash heredocs – write the file instead.

## Tests

- Unit tests are `*.test.ts` next to the code they cover (`node:test` + `assert`).
- The E2E suite (`e2e/`, Playwright, Chromium only) runs against the real app in Docker. Install the
  browser once with `npx playwright install chromium`; `npm run e2e:docker` builds the image, starts
  the app plus a mock print host, runs the specs and tears everything down.
- The suite writes presets, printers and autosave files, so it only ever sees a copy of
  `e2e/fixtures/data` (it refuses targets without the fixture marker preset). Never point it at a
  real install.

## Pull requests

- Branch from `main`: `feature/<short-name>`, one focused commit per logical step.
- Commit message: `<Area>: <imperative summary>`, a blank line, a short body, and the
  `Co-Authored-By:` trailer naming the model that wrote the code.
- Update the docs the change touches (`CHANGELOG.md`, `TODO.md`, `docs/UAT.md`,
  `docs/Feature-Comparison.md`); README only if setup changes.
- Fill the handover report (CONVENTIONS §8): what changed, test evidence, deviations, open points.
