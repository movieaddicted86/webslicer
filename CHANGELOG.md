# Changelog

## Unreleased

- **Session restore (UX):** opening WebSlicer again shows the last plater right away. After a reload –
  and after the browser was closed and reopened – the objects, instances, volumes, paint, height
  ranges, custom G-codes, the selected presets (unsaved modifications included), the plater/preview
  tab and the projection are back without a click; a toast says "Previous session restored" and
  offers **Start empty**, which clears the plater and drops the autosave so the next reload stays
  empty. The old "Unsaved session found – Restore/Discard" notice is gone; it only shows (with the
  error and a Retry) when the automatic restore failed. The server autosave stays the source of
  truth; a pending save is flushed on `visibilitychange → hidden` / `pagehide` with
  `fetch(…, { keepalive: true })`, so the last seconds before a reload are no longer lost, and a
  request larger than the 64 KiB keepalive budget is kept in IndexedDB and written on the next start.
  "Delete all", "Start empty" and a new import replace the stored autosave. Two tabs: last write wins
  (no tab sync).

- **Safety (S1-d):** settings are now checked before the slicer runs, and a print host can carry its
  own limits. `POST /api/slice` (and the project slice, and the MCP `slice` tool) run the new
  `shared/src/safety/configLimits.ts` over the request: a hotend temperature outside `0` or
  150–450 °C, a bed outside 0–150 °C, a chamber outside 0–100 °C, a nozzle outside 0.1–2.0 mm or a
  layer height that is not a number, ≤ 0 or more than 2× the nozzle answers **400** with the issues
  (`{ error, issues }`, each with `rule`, `severity`, `message`, `key`, `value`, `limit`). Per-extruder
  vectors are checked element-wise (`temperature = 215,2150` names the second one), `nil` and missing
  keys are skipped, and `0` stays allowed as PrusaSlicer's "off". Values outside the _usual_ window of
  the `filament_type` (PLA, PETG, ABS/ASA, TPU, PA, PC – the ranges come from the 2.9.6 system
  profiles) only **warn**; the warnings are returned with the job (`configIssues`) and listed in the
  preview. The MCP `set_settings`/`check_settings` report the same limit issues on top of their S1-a
  bands. A physical printer has a new optional `safety: { maxHotend, maxBed }` (zod-validated, editable
  in the dialog with a "PTFE hotend (max 240 °C)" button); the send gate compares the job's
  temperatures with it (`send.printer_limit`, **block**, overridable with a reason and audited) and
  passes the limits to the preflight when an older job has to be re-scanned. A job from before this
  change is judged on its stored request. `server/scripts/limits-sweep.ts` checks every bundled
  PrusaSlicer 2.9.6 system preset with the same rules – 0 blocking findings.
- **Plater:** a plate is checked before it is sliced, the way PrusaSlicer's GUI does it, instead of
  failing after a long job. The new pure `web/src/plater/plateCheck.ts` tests every printable
  instance's footprint against the **real bed polygon** (an object in the cut corner of an L-shaped
  bed is outside now, not only past the polygon's bounding box), adds the **brim** (`brim_width`)
  and the **skirt** (distance plus loop widths over all objects) and reports what leaves the print
  area, a too-tall object, a toolpath conflict between two instances and – with
  `complete_objects` – a pair closer than `extruder_clearance_radius`. The slice panel lists the
  issues; a blocking one disables **Slice now** with the reason in its tooltip, and the affected
  objects keep the red row. The rules were measured against PrusaSlicer 2.9.6: the slicer refuses
  an off-bed object ("All objects are outside of the print volume.") and colliding toolpaths
  ("gcode path conflicts found between …", a penetration of more than about 2 × the first-layer
  extrusion width), while it accepts overlapping objects in normal mode and sequential printing
  below the clearance radius – those stay allowed or warn. A job the slicer still fails now shows
  the slicer's own wording instead of a generic failure.

- **Security:** a slicer option key is now validated instead of filtered by name. SEC-1 dropped
  `post_process` and `output_filename_format` by an exact match on the raw client key, while the INI
  writer wrote the key unescaped – a key such as `"x\npost_process = echo pwned"` therefore wrote a
  second line into the `config.ini` that PrusaSlicer loads with `--load`, and the slicer ran that
  command as the service user (remote code execution, reachable from the LAN and, through DNS
  rebinding, from any website a LAN user opens). Now one rule – `isValidConfigKey` in
  `@webslicer/shared` (`^[a-z][a-z0-9_]*` plus a bracketed vector index such as
  `dynamic_overhang_speeds[0]`, which the bundled Sovol presets use) – is applied at three layers:
  the REST/MCP validation rejects a malformed key with **400** and the key in the message
  (`/api/slice`, `/api/presets/:type/:name`, `/api/projects`, `/api/library/project`, MCP
  `set_settings`); `mergeConfigs` drops every key that is malformed, server-only, or unknown to the
  installed slicer; and `serializeIni` refuses a malformed key outright. Unknown-but-well-formed keys
  are dropped rather than rejected, so old projects and presets keep loading. The same change adds
  the **Host/Origin guard**: `/api` and `/mcp` refuse a request whose `Host` is not `localhost`, a
  loopback address, an IP literal, one of this machine's interface addresses or a name from the new
  `ALLOWED_HOSTS` env variable (403); a browser `Origin` has to name an allowed host too. The MCP
  router's old `Origin == Host` check is gone – a rebound name always passed it. An install opened by
  IP, by host name or through a reverse proxy keeps working (`ALLOWED_HOSTS=webslicer.lan,nas`).
- **Safety (S1-c):** the G-code WebSlicer produces is now scanned before it can be sent. When a job
  finishes, the server reads the output file once (chunked, no full-file string; 0.7 MB in ~56 ms,
  60 MB in ~3.6 s) and stores the findings on the job (`info.preflight`, versioned). Five rules:
  `gcode.forbidden_command` (**block**) – `M500`, `M502`, `M211 S0`, `M92`, `M997`, `M851`, i.e.
  commands that store or reset the EEPROM, disable the endstops, change the steps/mm, flash firmware
  or move the probe offset; `gcode.max_temp` (**block**) – `M104`/`M109` above 450 °C and
  `M140`/`M190` above 150 °C (wide typo catchers; S1-d adds the per-printer limits);
  `gcode.no_homing` (**block**) – a move with X/Y/Z before the first `G28`, with
  `gcode.macro_before_move` (**warn**) instead when a printer macro (`PRINT_START`, …) comes first,
  because it may home; `gcode.firmware_limit` (**warn**) – `M201`/`M203`/`M204`/`M205` above the job
  printer preset's `machine_max_*` (Normal column, only when the preset defines them); and
  `gcode.motor_current` (**warn**) – `M906`/`M907`. The last one is a warning rather than a block on
  purpose: PrusaSlicer's own printer presets write `M907 E430`/`M907 E538` into their start and end
  G-code, so blocking it would refuse every file the slicer makes for an MK3S. Comments, lowercase
  and line numbers are understood (`M5000` is not `M500`), a finding carries its line number and the
  offending line, and each rule keeps its first five findings (the counts keep the total). Binary
  `.bgcode` output is not read and reports one `gcode.not_scanned` warning.
  The send gate merges these findings with the S1-b preset issues: a blocking finding answers
  **409** `{ error, issues }` (each issue now carries `line` and `text`), goes through with
  `{ "override": true, "reason": "…" }` and is written to `data/audit.log` like a preset mismatch. The
  send dialog lists the findings next to the preset issues with their line; the preview panel shows
  "Preflight: n blocking, m warnings" with the details in a collapsible section.
- **Testing:** the browser checks that so far lived in git-ignored `.claude/*-browser.mjs` scripts are
  in the repository as a Playwright suite (`e2e/`, `@playwright/test` 1.64.1 pinned, Chromium only,
  `retries: 0`, one worker). `npm run e2e:docker` builds the image, starts it with the fixture data dir
  (`e2e/fixtures/data`: an installed MK3S and no physical printers) and runs everything; `npm run e2e`
  runs against an app that is already up and has **no default target** – it refuses any instance
  without the fixture marker preset, because the suite deletes jobs and writes presets. The send tests
  upload to a **mock print host** (`e2e/mock-host`, a sibling container on a private network) – a real
  printer is never contacted. CI gets a second job, **sharded over three jobs**, that builds the image
  with the GitHub cache and runs its share of the suite. `docs/` and the product code are unchanged;
  the suite found two pre-existing 500s on `/api/export/3mf` and `/api/export/config` with an empty
  body, which are pinned as they are.

- Refactoring cleanup (R-12), no behaviour change: the web UI formats numbers, times and sizes
  through one `web/src/format.ts` instead of per-call-site helpers (the output strings are pinned
  by a unit test), exports that nothing imported are gone (`objectBounds`, `PAINT_NONE`,
  `TOOL_NAMES`, `resetSchemaCache`, … – see `.ai/reports/T-029.md`), the last runtime import cycle
  of the web store is broken (the autosave restore now lives in `importFiles.ts`), the volume type
  list is read from the shared `VOLUME_TYPES`, and 44 non-null assertions in non-hot paths became
  ordinary guards. No visible behaviour change: the T-017 and T-018 browser suites give the same
  DOM, the same values and pixel-identical screenshots on `main` and the branch.
- Refactoring of the slicer modules (R-11), no behaviour change: the three oversized files in
  `server/src/slicer/` are split by responsibility. `layout.ts` (1003 lines) became
  `slicer/layout/` – the curated tab table (`fff.data.ts`), the option metadata
  (`knownOptions.data.ts`), the vector key sets (`keySets.ts`) and the types. `threemf.ts`
  (596 lines) became `slicer/threemf/` – `mesh.ts` (STL parsing/writing, `transformMesh`),
  `read.ts`, `write.ts`, the custom G-codes and the shared XML helpers. `schema.ts` (424 lines)
  keeps the builder and hands the help parser (`help.ts`) and the per-option derivation
  (`optionDef.ts`) over. The code was moved, not rewritten: every function body is unchanged and
  two new pin tests (a `buildSchema` snapshot from the checked-in 2.9.6 help output and a written
  3MF compared entry by entry) hold the output byte-identical. The settings UI, `/api/schema` and
  every written 3MF are the same files as before.
- **Toolchain:** the web app runs on **React 19** (`react`/`react-dom` 19, matching `@types/react`)
  and **Vite 7** with `@vitejs/plugin-react` 5. `eslint-plugin-react-hooks` is on 7 with the same
  two rules as before, so no lint outcome changes. No behaviour change: the only forced code edit is
  the ref typing in `three/viewer/useScene.ts` (`MutableRefObject` was removed in React 19, where
  `RefObject.current` is writable). `StrictMode` stays.
- **Safety (S1-b):** sending G-code to a print host now checks that the host is the machine the file
  was sliced for. A physical printer can be linked to a printer preset (Printers → Edit → "Printer
  preset"); `POST /api/jobs/:id/send` compares that preset with the job's own printer preset and
  refuses a mismatch with **409** `{ error, issues }` – the G-code's start/end G-code, axis limits and
  nozzle belong to another machine. Presets are compared by lineage: the same name or a system preset's
  alias is the same machine; a preset that inherits the other (directly or through a chain) warns with
  `send.preset_derived`, because a derived preset can change the nozzle, axis limits or start/end
  G-code; two presets that only share an ancestor (siblings) are a mismatch and are blocked. A host
  without a preset only warns, because there is nothing to compare. A refused send is still possible
  with an override: `override: true` plus a reasoned text (trimmed, at most 500 characters, required) is
  accepted and written to `data/audit.log` (job, host, issues, reason, time) in the MCP audit format.
  The send dialog preselects the host that fits, lists the issues, asks for the override with its
  reason and, when "Start printing after upload" is ticked although a warning is shown, for an extra
  confirmation. Files that were sendable before are sendable unchanged when the host is linked to the
  matching preset – the REST contract apart from the new 409 and the two optional fields is untouched.
- **Safety (S1-a):** the MCP tools no longer let an agent prepare G-code outside the machine's
  limits. `set_settings` used to accept every key in every scope – including printer options such as
  `z_offset` or `bed_shape` – and only type-coerced the value. Now only process and material options
  are accepted (no printer scope, no G-code or script text, no multiline keys, no free text or
  coordinates), and a value has to stay near the resolved preset: temperatures ±25 °C, speeds
  ×0.5–×1.5, extrusion multiplier ±0.1, retraction length ±1 mm, per extruder element by element
  (`0` = off/auto stays allowed). A refused key rejects the whole call – nothing is partially
  applied – and the tool error lists every issue as `key: value – reason (allowed …)`. The new
  read-only tool `webslicer.check_settings` answers the same check as a dry run; rejected calls are
  logged in the MCP audit log with their reasons. `quick_settings` writes through the same path.
  The tool catalogue moved into one module per topic (`mcp/toolCatalog.ts`, `toolProjects.ts`,
  `settings.ts`, `toolJobs.ts`), behaviour unchanged; `get_option_schema` and `set_settings` describe
  the new limits. REST and the settings editor are untouched.

- **Security:** two slicer options are no longer passed on to PrusaSlicer, because the slicer acts on
  them on the **server** rather than inside the G-code. `post_process` ("Post-processing scripts") is a
  list of shell commands PrusaSlicer runs after the G-code export, and `output_filename_format` names
  the output file and accepts `..`, so it could write outside the job directory; anyone able to call
  `/api/slice`, `/api/projects/:id/slice` or the MCP `set_settings` tool could therefore run commands
  as the service user. Both keys are now dropped from every merged config – the REST slice route, the
  project slice, the MCP tools, the 3MF/config export and the autosave all go through the same merge –
  and a project no longer keeps them in its stored preset config. They are _not_ rejected as input:
  the browser's own presets, vendor bundles and 3MF projects may carry them legitimately. The MCP
  `set_settings` tool refuses them with a message that names the reason (an agent learns the rule),
  `get_option_schema` no longer lists them, and the settings editor shows them read-only with a note
  instead of an editor that would have no effect. Slicing output is unchanged for every request that
  does not set the two keys.
- Express 5, no behaviour change: the server runs on `express` 5 (`@types/express` 5). Express 5
  forwards the rejected promise of an async handler to the error handler, so the `asyncHandler`
  wrapper that every route of `routes/api.ts`, `routes/projects.ts`, `routes/library.ts` and the MCP
  endpoint was passed through is deleted instead of moved – the handlers are plain `async` functions
  now, and the error handler still answers the status and the JSON body of the thrown error (pinned
  by a test). Every endpoint, status code, body, header and file download is unchanged, checked by
  the HTTP contract tests and a `curl`-level smoke comparison of all 154 exchanges against the
  previous build, plus an MCP `tools/list` comparison and a browser pass over the deep link, the
  import, a slice with its SSE progress stream and the G-code download. One visible difference comes
  from the newer mime database: the vendor bed model is served as `model/stl` (the registered type)
  instead of Express 4's `application/vnd.ms-pki.stl`; browsers decide on the file extension, so the
  bed loads exactly as before.
- Refactoring of the request validation (R-10), no behaviour change: every payload the server accepts
  is described by one zod schema in `server/src/validation/` – the slice request (transforms,
  instances, ranges, volumes, paints, custom G-codes, thumbnails), the project create/models/arrange
  bodies, the printers, the presets, the library bodies and the job upload. The REST routes and the
  MCP tools use the same schemas, so a rule (and its message) no longer exists twice; the hand-written
  `isTransform` and the field checks in the routes are gone, and `copies` has one owner. Status codes
  and error messages stay as they were – the API contract tests and a `curl`-level smoke comparison
  of all 154 exchanges against the previous build pin them. Two payloads that used to crash the
  request handler with a 500 (an element of `objects`/`volumes`/`ranges`/`customGcodes`/`thumbnails`
  that is not an object, and a non-string `filename` in `POST /api/jobs/:id/send`) are now reported as
  the field error they are (400) or ignored, as the surrounding code already did.
- Refactoring of the server internals (R-9), no behaviour change: the server logic lives behind
  `server/src/services/` (slicing, projects, library, printers, models, config merge, autosave,
  schema, version) and no longer knows Express; the routes only validate, call a service and answer,
  and the MCP endpoint calls the same services instead of the routes. `jobs.ts` keeps the queue and
  the SSE stream, the job directory moved to `jobs/persistence.ts`. Errors carry their status as a
  type (`HttpError`/`ValidationError`/`NotFoundError`/`ConflictError` in `server/src/errors.ts`) and
  the request paths read and write with `fs/promises`, so a large file no longer blocks the event
  loop. Every endpoint keeps its method, path, status codes, headers and bodies – checked by the
  HTTP contract tests and a `curl`-level smoke comparison of all 154 exchanges against the previous
  build.
- Code quality tooling: ESLint 9, Prettier and GitHub Actions CI. `npm run lint` checks all
  three workspaces (typescript-eslint recommended, the React hook rules for `web/`, no `any`, no
  non-null assertion as a warning until R-12), `npm run format`/`format:check` enforce the
  repository style and `.editorconfig` carries it into editors. The whole repository is formatted
  in one format-only commit. `.github/workflows/ci.yml` runs `npm ci` → type check → lint →
  format check → tests → build on every push and pull request. Behaviour is unchanged; the fixes
  were unused imports and one `useMemo` dependency.
- Camera of the 3D view like PrusaSlicer: the number keys **0–6** put the camera on the standard
  views (Iso, Top, Bottom, Front, Rear, Left, Right), **K** switches between the perspective and the
  orthographic projection and **Z** zooms to the selection – the picked instance, the selected
  objects, otherwise the whole bed, and in the preview the toolpaths of the visible layers. A small
  view toolbar sits at the top right of the 3D view next to the reset-view button. Every camera
  command frames a box through the same maths (`plater/camera.ts`, unit tested without WebGL), and
  the two cameras are moved together: the orthographic frustum gets the area the perspective camera
  shows at that distance, so switching the projection keeps the framing, and the choice is remembered
  in `localStorage`. The platter no longer limits the polar angle, so the camera can go below the bed
  for the bottom view; the print bed is drawn single sided for the same reason (it used to blend over
  the model when looking from below). G-code thumbnails are unaffected – the preview keeps its own
  camera
- Preview like PrusaSlicer, part 2: the **feature legend** now shows the time, the share of the print
  time and the extruded length of every feature type, plus a Travel row with its time (travel is not
  extruded, so it has no share of its own and the shares of the other rows add up to 100 %). The times
  come from the feedrates of the G-code and are scaled to the slicer's estimate, exactly like the
  layer times in the range legends; the parser sums them per feature type while it walks the file, so
  it adds no second pass. A finished job that sliced with **warnings** shows them in a collapsible
  yellow box above the statistics instead of leaving them in the log – the server reads the warning
  blocks out of the slicer log (`print warning: Empty layer between 8.15 and 12.35.` plus the object
  name, the hint and the stability issues), deduplicates them and keeps at most 20; a clean job shows
  no box
- MCP endpoint for agents (phase 1): the server speaks the Model Context Protocol over Streamable HTTP
  at `/mcp`, so an assistant can look through printers, presets and the library, build a project and
  slice it. The endpoint exists only with a token – without `MCP_TOKEN` it answers 404, a missing or
  wrong bearer token 401. Tokens are scrypt hashes in `data/mcp-tokens.json` (the environment token is
  kept there as the owner `admin` and removed again when the variable disappears), every call lands in
  `data/audit.log` with time, token id, owner, tool and parameters but without secrets, and a token
  only ever sees the projects of its own owner. Eleven tools: `webslicer.list_printers`, `list_presets`,
  `get_option_schema`, `list_library`, `create_project`, `add_model`, `arrange`, `set_settings`
  (validated against the option schema), `quick_settings`, `slice` and `get_job`; the read-only ones
  carry `readOnlyHint`, and `set_settings` rejects unknown options and options of another preset type.
  The job result now also reports the layer count (read from the `;LAYER_CHANGE` markers of the
  G-code). The README section "MCP" documents Docker Compose, the Proxmox environment file and client
  configuration for Claude Code and Claude Desktop; `server/scripts/mcp-e2e.ts` runs the complete
  workflow (library → project → settings → slice → evaluation) against a running server
- Server-side projects (MCP phase 0): the server can build and slice a plater without a browser.
  `POST /api/projects` creates a project for a printer/print/filament preset (names plus overrides),
  `POST /api/projects/:id/models` adds an STL or 3MF from the library (3MF: one object per `<object>`,
  one instance per `<build><item>`, placed exactly where the file has them; `copies` repeats the
  instances), `POST /api/projects/:id/arrange` packs the instances with the same shelf algorithm the
  browser uses, `POST /api/projects/:id/slice` answers with a job record (no thumbnails headlessly) and
  `GET /api/projects/:id` reads the state back. A project is a JSON file in `data/projects/`, expires
  24 h after its last use and keeps its models alive; expired projects and their models are removed by
  the cleanup that runs with the model pruning. The browser UI is unchanged
- Preview like PrusaSlicer, part 1: a **horizontal slider** under the layer sliders plays the moves of
  the top visible layer one by one (at the end of its range it shows the whole layer again) and a small
  tool marker sits at the current position – moving a layer slider resets it to "end of layer". The
  **view options** below "Show travel moves" switch retractions (magenta), deretractions (cyan-green),
  seams (light grey), wipe moves (yellow lines), tool changes (red) and colour changes (blue-grey) on and
  off independently, and **Shells** draws the plater objects translucent over the toolpaths. The parser
  records the markers and a global move index per move, so a slice cut at any point of a layer is drawn
  without re-parsing; a 300 000-segment G-code stays interactive
- Unsaved-changes dialog like PrusaSlicer: switching a print, filament or printer preset while the
  current one is modified asks what happens to the changes – **Transfer** (the new preset takes them
  over and shows as modified), **Save** (the changed preset is saved under a name, then the switch
  happens), **Discard** (switch without them) or **Cancel** (stay). The dialog lists every changed
  option with label, key, old and new value; Transfer is disabled for printer presets, because those
  describe the machine. The browser `confirm()` is gone
- Split to objects / split to parts: a model made of several separate shells (a plate of parts
  exported as one STL) is split with one click into independent objects or into parts (ModelPart
  volumes) of the same object. "Split to objects" gives every shell an object of its own with the
  original settings, height ranges and per-triangle paint, and every copy of the object keeps its
  exact place; "Split to parts" keeps the largest shell as the mesh and turns the rest into parts.
  A hollow shell (an inward-facing inner wall) stays with the shell that encloses it, so a hollow
  object counts as one part, and a single-shell object reports "The object consists of a single
  part". One undo step each, buttons in the manipulation panel and in the object list
- Instances: set the number per object (1–1000), "Fill bed" places as many copies as fit, "Add instance" /
  "Remove instance" buttons and the `+` / `-` keys, a `×n` badge in the object list that expands into one
  row per instance (select, set as separate object, delete). All instances share one mesh, its volumes,
  paint and settings but have their own position, rotation and scale; slicing sends one transform per
  instance, so the slicer plans them in one job and the filament/time estimates cover all copies
- Mirror X / Y / Z buttons in the manipulation panel: they flip the picked instance, or every instance
  of the selection, about the world axis through the instance position (double mirror restores the
  original), drop the result back onto the bed, and are one undo step each. The size fields keep showing
  the magnitudes, the sign lives on the scale axis the mirror negated, and a mirrored project survives
  save, reload and desktop PrusaSlicer (the 3MF keeps the negative-determinant item transform)
- Arrange packs the instances themselves (not whole objects), so a part-placed object is filled efficiently
- 3MF projects save and restore the instances (one `<item>` per instance), so a project reopened from the
  library, the autosave or desktop PrusaSlicer comes back with the same layout
- Colour change (M600), pause (with printer message) and custom G-code at a layer: buttons at the top
  slider position in the preview, markers on the slider, editable list, automatic re-slice; stored in
  the 3MF as `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml` and read from PrusaSlicer projects
- Preview colour mode "Color print" with a legend of the colour segments
- The preview keeps the slider position when re-slicing
- Preview colour schemes like PrusaSlicer: height, width, speed, fan speed, temperature, volumetric flow
  rate, layer time (linear and logarithmic) and tool, each with a gradient legend of the value range
- Proxmox helper reworked in the style of the community-scripts: header, Default/Advanced settings
  (OS version, container type, password or console autologin, ID, hostname, disk, CPU, RAM, bridge,
  static IP/gateway, IPv6, VLAN, MTU, MAC, DNS, SSH key/root login, web port, model library bind mount,
  PrusaSlicer version, tags, verbose), storage picker with free space, step progress with spinner and
  a log file, clear error output, no password printed, `update` command inside the container; running
  the helper inside an existing WebSlicer LXC updates it
- Installer: no locale warnings, quiet npm, settings persisted for updates, service user with fixed
  uid 1050 (host uid 101050 in unprivileged containers) for bind-mounted libraries
- Helper: when the container does not start, the real LXC error is shown (debug start log); if the
  model library mount prevents the start, the install continues without it and explains how to add it
  later; the library is checked for write access with a share-type specific hint (CIFS, NFS, local)
- Helper: the LXC template is chosen for the host architecture – `pveam` also lists arm64 templates,
  and an x86_64 host could get the arm64 Debian 13 template ("Exec format error" on start)

## 1.0.0-rc.2 – 2026-10-17

UAT run (docs/UAT-Report.md): UAT-01 to 14, 16 and 17 passed. Fixed findings:

- custom printer: falls back to "- default FFF -" instead of keeping an incompatible vendor print profile
- camera follows the bed size when switching printers
- model names containing "&&" are shown as "&"
- top bar wraps on narrow windows, no horizontal page scrolling
- Simple mode hides the object list with modifiers, painting and height ranges in the plater, like PrusaSlicer

## 1.0.0-rc.1 – 2026-10-17

First release candidate for the user acceptance test.

### Slicing

- PrusaSlicer engine 2.9.6 (CLI) in the container, all print/filament/printer options of the installed version
- vendor profiles of all bundled vendors with inheritance, compatibility conditions and alias resolution
- user presets as PrusaSlicer-compatible INI, the printer's default profiles are selected automatically
- per-object settings, modifiers, support enforcers/blockers, negative volumes, additional parts
- support, seam and MMU painting; height ranges with their own layer height
- G-code with thumbnails (PNG/JPG/QOI) in filament colour

### User interface

- 3D plater with gizmo, numeric input, place on face, arrange, undo/redo, vendor bed
- settings tabs like PrusaSlicer (Simple/Advanced/Expert, search, modified markers)
- quick settings supports/infill/brim, G-code preview with layer slider and legend
- file library (mounted directory), project save/load, autosave with restore
- upload to PrusaLink, OctoPrint, Klipper/Moonraker, optionally with self-signed certificate

### Operations

- Docker image (≈ 1.2 GB) with Compose file, volumes `/data` and `/library`
- Proxmox LXC helper and Debian installer with systemd service
- sample models are copied into the library on first start
