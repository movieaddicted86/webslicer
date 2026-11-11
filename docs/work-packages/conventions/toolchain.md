# Toolchain and commands

Part of [CONVENTIONS.md](../CONVENTIONS.md) §3.

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
`--test-reporter=dot` goes **before** the glob: after it, Node ignores the flag.

CI (`.github/workflows/ci.yml`) runs on every push and pull request: `npm ci` → `npm run typecheck`
(the server step also type checks its test files) → `npm run lint` → `npm run format:check` → `npm test`
→ `npm run build`. Its token is read-only (`permissions: contents: read`); dependency updates arrive
through Dependabot (`.github/dependabot.yml`). Lint and formatting are
part of the definition of done, so run both before you push. CI runs `lint` without a cache.

The server needs the PrusaSlicer binary, so for UI work run the server in Docker and the web app
with Vite. The dev machine is Windows 11 with Git Bash/PowerShell: set `MSYS_NO_PATHCONV=1` for
`docker run -v` paths and do not pass TypeScript through Bash heredocs (write files instead).
