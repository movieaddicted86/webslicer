# Development

Working on WebSlicer itself. The engineering rules are binding and live in
[work-packages/CONVENTIONS.md](work-packages/CONVENTIONS.md) and
[work-packages/CODING-GUIDELINES.md](work-packages/CODING-GUIDELINES.md); work packages for larger
changes are in [work-packages/](work-packages/).

## Commands

```bash
npm install
npm run dev          # shared/dist, then Vite (5173, proxy → API) + server (8080, tsx watch)
npm run typecheck    # shared + web + server
npm run build        # shared/dist + web/dist + server/dist
npm test             # shared + server + web tests (builds shared first)
npm run lint         # ESLint 9, all workspaces and e2e
npm run format       # Prettier; `format:check` is what CI runs
```

For local development PrusaSlicer must be reachable (`PRUSASLICER_BIN`); on Windows the
`prusa-slicer-console.exe` of the desktop installation is found automatically.

## Repository layout

```
shared/   @webslicer/shared – pure TypeScript used by web AND server (no React, no Express, no three.js)
web/      React + Three.js + Zustand (Vite)      → plater, settings UI, G-code preview (web worker)
server/   Node 22 + Express
  routes/              one router per resource, validate → service → respond
  services/            use cases shared by REST and MCP
  slicer/cli.ts        the one seam that invokes prusa-slicer
  slicer/schema.ts     option schema from --help-fff/--help-sla + curated tab layout
  slicer/bundles.ts    vendor bundles (resources/profiles/*.ini) with inheritance
  slicer/condition.ts  evaluation of compatible_*_condition
  slicer/presets.ts    system/user presets, installed printers
  slicer/threemf/      STL parser, 3MF writer/reader (transforms, volumes, paint, height ranges)
  jobs.ts              job queue, progress (SSE), G-code statistics
  mcp/                 the /mcp endpoint and its tools
proxmox/  LXC helper (host) + installer (container)
e2e/      Playwright suite (specs, helpers, mock print host, Docker runner)
samples/  the sample models the image seeds the library with
```

Slicing flow: the browser loads the model, normalizes the geometry and uploads it as STL. On slicing
the server builds a 3MF from all objects + transforms, writes the merged configuration
(print + filament(s) + printer) as `config.ini` and calls
`prusa-slicer --export-gcode --load config.ini --dont-arrange model.3mf`.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: `npm ci` → `npm run typecheck` (the
server step also type checks its test files) → `npm run lint` → `npm run version:check` →
`npm run format:check` → `npm test` → `npm run build`, then the E2E suite in four shards. A push that
only touches Markdown, `docs/` or `LICENSE` skips the E2E shards.

## API (excerpt)

| Method         | Path                       | Purpose                                    |
| -------------- | -------------------------- | ------------------------------------------ |
| GET            | `/api/schema`              | option schema + layout                     |
| GET            | `/api/vendors`             | vendors & printer models                   |
| POST           | `/api/presets/:type/list`  | presets (with compatibility)               |
| GET/PUT/DELETE | `/api/presets/:type/:name` | read preset / save as user preset / delete |
| POST           | `/api/models`              | upload STL (body = binary STL)             |
| POST           | `/api/convert/step`        | STEP → binary STL (`x-filename` = name)    |
| POST           | `/api/slice`               | create job → `202 {id}`                    |
| GET            | `/api/jobs/:id/events`     | progress (SSE)                             |
| GET            | `/api/jobs/:id/gcode`      | result (`?download`)                       |
| POST           | `/api/jobs/:id/send`       | upload to a physical printer               |
| POST           | `/api/export/3mf`          | project 3MF                                |
| GET            | `/api/library`             | file library                               |

The send gate (409, override with a reason, preflight findings) is described in
[safety.md](safety.md#the-send-endpoint).

## The E2E suite

The browser checks live in `e2e/` (Playwright, Chromium only). They run against the **real app** –
the server, the PrusaSlicer CLI and the built frontend – with the fixture data dir
`e2e/fixtures/data` (an installed MK3S, no physical printers).

```bash
npm ci
npx playwright install chromium        # once per machine, after `npm ci`
npm run e2e:docker          # build the image, start it + the mock print host, run everything, stop it
npm run e2e:docker -- viewer.spec.ts   # a single spec
E2E_BASE_URL=http://localhost:8081 npm run e2e   # against an app you started yourself
```

`e2e:docker` copies the fixture data to a temp dir, builds `webslicer:e2e`, starts it on the first free
port from 8080 and adds a **mock print host** (`e2e/mock-host`, a sibling container on a private
network). The send tests upload to that mock – a real printer is never contacted. Without the mock
(the `npm run e2e` form) the send tests skip.

There is **no default target**: without `E2E_BASE_URL`, `npm run e2e` stops with a message. The suite
deletes jobs and writes presets, printers and autosave files, so it must only ever see a copy of
`e2e/fixtures/data` – and it checks that: the fixture dir carries a marker preset
(`E2E fixture – do not use`) that no real instance has, and the global setup refuses a target without it
before it writes anything. A hand-started server for the suite therefore needs that data dir (or the
marker copied into it); never point it at your working install.

- Specs by area: `smoke`, `viewer`, `camera`, `sidebar`, `dialogs`, `preview`, `send`, `api-smoke`.
- `retries: 0`: a flaky test is a failure, not a retry. Locally one worker runs; CI runs **two**
  (`playwright.config.ts`). Every test gets its own browser context and autosave id; the few tests
  that read or write the server's printer list or the mock host's upload log take the `server-state`
  test lock, so two workers cannot see each other's hosts.
- Tests inside a spec run one after another (`fullyParallel: false`), because most specs edit one
  plater between tests. `preview.spec.ts` and `sidebar.spec.ts` are the exception: every test there
  gets its own page and its own import, so they turn on `test.describe.configure({ mode: 'parallel' })`
  for themselves and use both workers. A new spec may do the same only if nothing carries between its
  tests (no module-level plater state, no server write).
- Specs whose tests only read the sliced result share **one slice per spec** (`sliceOnce` in
  `e2e/helpers/fixtures.ts`, called from `beforeAll`); the tests load that job into their own page.
- On failure Playwright keeps a trace, a screenshot and the error context in `test-results/`; in CI each
  shard uploads its own `playwright-report-shard-<n>` artifact.
- CI runs the whole suite in the **official Playwright image** (`mcr.microsoft.com/playwright:v<version>`,
  the version taken from `@playwright/test`), so browsers and their system libraries are preinstalled
  and there is no `playwright install` step. The app image is built **once** in a `build` job and the
  four shards only load it from the build cache. The shards are weighted by the measured time of each
  spec (`PWTEST_SHARD_WEIGHTS`, set in the workflow), two workers each. A push to a branch cancels the
  run it supersedes; `main` runs are never cancelled.
- `PWTEST_SHARD_WEIGHTS` is Playwright-internal (undocumented): it weights the shard sizes, while
  Playwright still hands out contiguous **file groups**, so only the boundaries move. The current
  weights make the groups 33 / 23 / 32 / 29 tests across the 117-test suite, and give each shard at
  most one **expensive** locked spec (`preview`, `send`, `dialogs`): Playwright's `lock` applies
  to the whole file group, so two locked specs in one shard run strictly one after the other. Shard 1
  also holds `api-smoke`, whose lock covers a 3-second file. After a
  Playwright bump (the Dependabot `playwright` group) re-check the assignment with
  `for i in 1 2 3 4; do npx playwright test --list --shard=$i/4; done` (with `E2E_MOCK_URL` and
  `E2E_MOCK_DIR` set, otherwise the send tests are skipped and the counts shift). If the variable is
  ever ignored, the shards fall back to the count-based split – correct, just less balanced.

## Documentation screenshots

The images in `docs/images/` are generated, not hand-made: `npm run docs:screenshots` drives the app
with Playwright, loads the sample models and writes the PNGs used by the README and the docs pages.
Refresh them after a UI change; [e2e/scripts/screenshots.ts](../e2e/scripts/screenshots.ts) documents
what each shot shows.
