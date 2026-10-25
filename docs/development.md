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

## The app shell

`web/src/components/AppShell.tsx` is the frame; `App.tsx` only starts the session and renders it.
One CSS grid in `AppShell.css` lays the app out, named by area:

```
rail | bar
rail | scene
 64px  1fr
```

- **rail** – `Rail.tsx`: the app's places (Slicing, Library, Printers, Preferences, About), icon above
  an 11 px label, the current place filled with the accent colour. It becomes a bottom tab bar below
  640 px. The update notice sits in the top bar's right edge.
- **scene** – the `.scene-area` with the `DropZone` and the `Viewer`; three.js resizes through its
  `ResizeObserver`, so the canvas follows its container without a second resize path. The scene is the
  **whole** area right of the rail below the bar: the object list and the context panel are cards that
  float over it, not grid tracks, so folding a card or hiding the panels never resizes the canvas. Its
  own overlays keep to the band the cards leave free: the tool strip at the top, the view bar
  (`Viewer.css`: `.viewer-bar-band` centred, the reset button on its right edge) below it. A click that
  hits no object ends the open tool through the same close as ✕/Esc and clears the selection
  (`viewer/useScene.ts`); a drag beyond a few pixels and a click on the transform gizmo are not clicks.
- **object list card** – `components/left/LeftColumn.tsx`, absolutely positioned at the scene's top
  left (`--card-gap` off both edges) with the mockup's card look (radius 10, 1 px line, soft shadow,
  slightly translucent, light backdrop blur). Its own header carries the title, the object count and
  the chevron that folds the whole card; the body holds the object list and, in the Preview, the Sliced
  info and Legend cards (`SideCard.tsx` is the card frame with its chevron). The frame publishes the
  card's width as `--list-w` from the `layout` slice (the remembered width, 220–420 px, 276 px by
  default, 148 px while folded, 0 on a phone). The card reads and writes that state through
  `useLeftColumn()`.
- **context panel** – `components/context/ContextPanel.tsx`, a card floating at the scene's top right,
  with the footer card (**Destination** and the Slice panel, `SlicePanel.tsx`) below it: a header (the
  object name and instance count, or "Plate" / "Preview"), the scrolling body and the footer. The body
  follows the mode
  the pure selector `contextMode` (`web/src/state/contextMode.ts`) derives – tool > preview > object >
  plate – from `activeTool`, `view`, `selectedIds` and `objects`; nothing about the mode is stored, so
  closing a tool, leaving the preview or deselecting switches the content on its own. In _tool mode_ the
  column is the tool's panel: `ToolMode.tsx` picks the component by the open tool's registry `panel`
  kind (`components/tools/panels/`), and `ToolPanel.tsx` supplies the frame – title, ✕, the scrolling
  body, the sticky primary action and `ToolHints.tsx` reading the tool's `hints` from the registry. The
  other modes show the plate content (`PlateMode.tsx` – the printer card), the preset rows and quick
  settings (`Presets.tsx`, in both plater modes, as they describe the print and not the selection) and,
  for one selected object, the cards `TransformCard`, `SettingsCard`, `PartsCard` and the range card
  with `RangePanel`. `PanelCard.tsx` is the card frame (a `section` with its `aside` heading, an icon
  and an optional action slot). Simple mode shows the plate content only; the Preview keeps
  `PreviewPanel`. Only a tool whose registry entry has a `panel` becomes `activeTool` (`tools/activate.ts`):
  move, rotate and scale set `transformMode` alone, so the column never switches to an empty tool mode; a
  tool that stops being showable – its object deleted, the selection dropped to two objects – is closed by
  the guard in `state/toolGuard.ts`, which leaves the panel in plate or object mode with the footer.
- **tool strip** – `components/tools/ToolStrip.tsx`, a pill floating over the top of the scene
  between the two cards (`position: absolute` in the scene's rectangle). The pill sits in
  `.tool-strip-band`, the part of the scene the cards leave free, and is centred in it; the band is
  measured with a `ResizeObserver`, so folding a card gives the strip more room at the same window
  width. It renders the registry: the groups in PrusaSlicer's order (selection, instance, transform,
  paint, cut, layer), the open tool's button in the accent colour, and the object commands delete,
  add instance, remove instance, arrange and arrange settings from `tools/stripCommands.ts` (whose
  actions `tools/stripActions.ts` also serves to the keyboard handler – one rule, one place).
  `stripLayout.ts` decides from the band's width which groups fit and which move into the **⋯** menu;
  below 900 px the pill scrolls sideways instead. Names appear only while the whole strip fits with
  them. The strip is not a panel: the tool's controls are the context panel's tool mode.
- The settings views (Print/Filament/Printer) replace the left column, the scene and the context panel
  and take the whole area right of the rail.
- The top bar (`TopBar.tsx`) is 48 px and one row: the `Menu` dropdown (`AppMenu.tsx`), undo/redo, the
  hide-panels switch, the project name with its save state and, centred in the bar, the
  _Prepare | Preview_ switch (a `radiogroup` from `VIEW_SWITCH_ENTRIES` in `nav/navMap.ts`); on a
  phone it also carries the button that opens the object list drawer. No view tabs are rendered
  anywhere else (`navMap.test.ts` and `navigation.spec.ts` check the one home).

The shell state is the `layout` slice (`web/src/state/slices/layout.ts`): `panelsHidden`, `leftWidth`,
`leftCollapsed` (each persisted in `localStorage` behind a try/catch), the folded cards
(`leftCards`) and the phone drawer (`leftDrawerOpen`, not persisted). Hiding the panels takes both
cards off the screen (they stay mounted, so their state survives) and the scene's overlays – the strip
and the view controls – use the whole scene again; the canvas keeps its size because it never took the
cards' width. New regions carry a `data-testid` hook (`rail`, `left-column`, `left-column-toggle`,
`context-panel`, `context-header`, `context-footer`, …); `e2e/hooks.test.ts` keeps that list and the
components in agreement, so a later layout step can move a region without rewriting the specs. The
design is in [design/Layout-3.0.md](design/Layout-3.0.md).

## Icons

Every icon is addressed by the function it performs, never by its picture: components use
`<Icon name="move" />`, and `web/src/icons/table.ts` maps the function to PrusaSlicer's artwork or, for
the few pieces of generic chrome Prusa has no icon for, to a lucide glyph. A component never imports
an icon library directly.

The Prusa SVGs are vendored, not fetched at runtime. `scripts/vendor-icons.mjs` downloads the fixed
list from `prusa3d/PrusaSlicer` at the commit recorded in the script (network needed), normalises it
and writes `web/src/icons/prusa/<file>.svg` plus the generated `web/src/icons/prusa/index.ts`. Run it
from the repository root; it is idempotent and prints what changed:

```bash
node scripts/vendor-icons.mjs           # vendor the icons the map marks "we have it"
node scripts/vendor-icons.mjs --sheet   # regenerate docs/design/icon-sheet.html
```

To add an icon: add the function and its Prusa file to the icon map (`docs/design/Icons-and-UX.md`
§3) and to `ICONS` in the script, run the script, then add the function name to `ICON_TABLE` in
`web/src/icons/table.ts`. `web/src/icons/icons.test.ts` fails when a table entry has no vendored file,
when the generated index and the files disagree, or when an SVG still contains a near-white fill.
Licence and provenance are in `THIRD_PARTY_NOTICES.md`.

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

- Specs select the app's structure by its **hooks**, not by its class names: `data-testid`
  attributes named by role (`tool-panel`, `object-row`, `modal`, …) that stay valid when the layout
  moves an element. Use `byId(page, 'tool-panel')` from `e2e/helpers/hooks.ts`, or the attribute
  directly inside `page.evaluate`. Field labels, button texts and ARIA roles stay as they are. The
  full hook list and the rules are in `docs/work-packages/CONVENTIONS.md` (§5, "E2E selectors");
  `e2e/hooks.test.ts` runs with `npm test` and fails on a legacy structural selector.
- Specs by area: `smoke`, `viewer`, `camera`, `sidebar` (the context panel), `dialogs`, `preview`,
  `send`, `api-smoke`.
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

The animation at the head of the README and of [features.md](features.md) is generated too:
`npm run docs:gif` records library → model → slice → preview → send and writes `docs/images/hero.gif`
(1280 × 720, about 13 s). It starts the E2E image and the mock print host from `e2e/mock-host` on a
private Docker network with a throwaway copy of the fixture data, so a real printer is never involved;
the send step uploads to the mock only. `GIF_SKIP_BUILD=1` reuses an existing `webslicer:e2e`.
[e2e/scripts/hero-gif.ts](../e2e/scripts/hero-gif.ts) documents the steps it records.

The image budget is 300 KB per PNG – a screenshot above it was not clipped enough. The GIF is the one
exception: it may reach 4 MB, and the script fails with a clear message when it does, so a recording
that grew cannot land in the docs unnoticed.
