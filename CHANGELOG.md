# Changelog

## Unreleased

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
