# Concept: MCP integration for WebSlicer

As of 2026-10-17 · Status: **concept and planning, not implemented**

## 1. Goal and value

An MCP server (Model Context Protocol) makes WebSlicer controllable by LLM agents: Claude, ChatGPT
clients, Home Assistant assistants or custom agents can load models from the library, pick profiles,
change settings, slice, evaluate results and send G-code to printers. Typical uses:

- "Slice `bracket_v3.stl` for the MK4S with 0.15 mm, 40 % infill, supports everywhere, and send it to the printer."
- "How long does the Benchy take with 0.2 instead of 0.1 mm and how much filament does that save?" (variant comparison)
- Automation: watch folder, nightly batch slicing, print queues, cost calculation.
- Assistance in the UI: a chat panel in WebSlicer that knows the current plater ("make the walls thicker").

The foundation already exists: all functionality runs through the server's REST API (`/api/...`)
and slicing is headless. Only mesh processing (import, normalization, volumes, thumbnails) happens in
the browser today.

## 2. Architecture options

| Option                                                                | Description                                                                                                                      | Assessment                                                                                                                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. MCP endpoint in the WebSlicer server** (`/mcp`, Streamable HTTP) | `@modelcontextprotocol/sdk` in the Express server; tools call the internal functions directly (jobs.ts, presets.ts, library.ts). | **Recommended.** No second component, uses job queue, library and presets directly, one Docker image. Ideal for clients on the LAN (Claude Desktop, Home Assistant).         |
| B. Separate MCP server (stdio) as npm package                         | Small process on the client machine that talks to WebSlicer's REST API.                                                          | Good for Claude Desktop / Claude Code over stdio without exposing the MCP endpoint on the network. Can later be derived from A (same tool definitions, different transport). |
| C. REST + OpenAPI only                                                | Agents use the REST API via generic HTTP tools.                                                                                  | No MCP benefit (discovery, schemas, prompts, resources). Fallback only.                                                                                                      |

Decision: **implement A, add B as a thin stdio wrapper later** (shared tool definitions in
`server/src/mcp/tools.ts`, interchangeable transport).

## 3. Prerequisite: headless model import

For an agent to work without a browser, the server must read and prepare models itself:

1. **STL** – available (`threemf.ts: parseStl`).
2. **3MF** – project metadata is already read; missing: mesh extraction from `3D/3dmodel.model`
   (vertices/triangles per object, build item transform) → small XML parser, no browser needed.
3. **OBJ/AMF** – optional, low priority (an OBJ parser is trivial).
4. **Normalization** as in the browser (XY centre, min Z = 0) and placement/arrange server-side
   (the arrange algorithm from `store.ts` is ported to `server/src/plater.ts`).
5. **Thumbnails** – no WebGL without a browser. Options: (a) slice without thumbnails, (b) software
   rendering via `three` + `headless-gl` or a simple z-buffer rasterizer in TypeScript (sufficient for
   16×16 to 480×240 previews). Recommendation: (b) simple rasterizer, as a pure Node solution.

Result: a server-side "plater model" (objects, transforms, volumes, presets) that both the UI and MCP
tools can create and slice. The format is already the `SliceRequest`.

### 3.1 Server-side projects (REST) – phase 0 as implemented

`server/src/plater/` holds the headless plater (`meshes.ts` import, `normalize.ts` browser
normalisation, `packing.ts` port of `web/src/plater/packing.ts`, `project.ts` state). A project is a
JSON file in `data/projects/<uuid>.json` with the preset names plus the overrides the caller changed,
and the objects with their instance matrices; the meshes live in the model directory like any uploaded
model. A thin REST surface exposes it (the browser UI does not use these routes):

| Route                            | Body                                                                                | Answer                                           |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `POST /api/projects`             | `{ printer, print, filaments?, owner? }` – a preset name or `{ name, config }` each | 201 with the project                             |
| `GET /api/projects/:id`          | –                                                                                   | the project, 404 if unknown or expired           |
| `POST /api/projects/:id/models`  | `{ libraryPath, copies? }` (1–1000)                                                 | the project with the added objects               |
| `POST /api/projects/:id/arrange` | –                                                                                   | the project with the instances packed on the bed |
| `POST /api/projects/:id/slice`   | `{ binaryGcode?, outputName? }`                                                     | 202 with the job record (like `POST /api/slice`) |

Inputs are validated like `validateSliceRequest`; a bad library path, an unknown preset, too many
instances or objects that do not fit on the bed answer 400 with a message, an unknown project id 404.
3MF import puts the objects of the file at the file's positions (one object per `<object>`, one
instance per `<build><item>`); modifiers, parts and paint inside a 3MF are ignored in this phase.
Headless slices carry no thumbnails (a rasterizer is phase 3).

Projects expire 24 h after their last use (override with `PROJECT_TTL_HOURS`). The cleanup runs
together with `pruneModels` (on start and every 6 h) and deletes expired projects and the models only
they used; a model referenced by a live project is never pruned.

## 4. Tool catalogue

Naming convention `webslicer.<verb>_<object>`; all inputs as JSON Schema (zod, `server/src/mcp/tools.ts`
exports the catalogue). The tools of phase 1 are implemented and marked ✔; the rest is still planned.

### 4.1 Implemented in phase 1 (T-006)

**Discover**

- ✔ `list_printers()` → installed printers, their printer presets, and the default preset names
- ✔ `list_presets(type, printer?, print?)` → print/filament/printer presets with the compatibility flag
  (a printer only shows presets of an installed printer model – the setup wizard installs them)
- ✔ `get_option_schema(query?, type?, limit?)` → options with label, type, default and enum values
  (substring over key, label, category and tooltip; an exact key match ranks first)
- ✔ `list_library(path?)` → models, projects and G-code in the library (`resolveLibraryPath`)

**Build a project**

- ✔ `create_project(printer, print, filaments[])` → `project_id` (server-side state, TTL 24 h,
  max. 20 live projects per owner)
- ✔ `add_model(project_id, library_path, copies?)` – STL or 3MF (3MF keeps its objects and placements)
- ✔ `arrange(project_id)` – the shelf algorithm of the browser
- ✔ `set_settings(project_id, scope, values)` – validated against the schema and the safety rules of
  §5.1 (allowlist, bands); unknown keys and keys of another preset type are rejected; `scope` is
  `print`, `filament` or `filament[<index>]` (the printer scope is closed)
- ✔ `check_settings(project_id, scope, values)` – the dry run of `set_settings`: same input, answers
  `ok` or the issues (key, value, reason, allowed range) and writes nothing
- ✔ `quick_settings(project_id, {supports, infill, brim})` – the three plater quick settings, mapped to
  the same keys the browser writes (the same apply path, so the rules of §5.1 apply here too)
- `transform_object(project_id, object_id, …)`, `place_on_face`, `set_object_settings`,
  `add_modifier(...)`, `add_height_range(...)` (phase 2)

**Slice and evaluate**

- ✔ `slice(project_id)` → `job_id` (headless, no thumbnails; progress via `get_job`)
- ✔ `get_job(job_id)` → status, progress, time, filament (mm/g/cost), layers and the warnings of the
  slicer log
- `compare(project_id, variants[])` (phase 3), `export_project`, `export_gcode` (phase 2)

**Printers** – `list_print_hosts`, `test_print_host`, `send_to_printer` (phase 3, with confirmation),
later `printer_status(host_id)`.

### 4.2 Still planned

- Object tools (phase 2): `transform_object`, `place_on_face`, `set_object_settings`, `add_modifier`,
  `add_height_range`; `search_library(text)`; `export_project`, `export_gcode`
- Resources (phase 2): `webslicer://presets/{type}/{name}`, `webslicer://jobs/{id}/log`,
  `webslicer://library/{path}` (3MF/G-code as binary resource), `webslicer://schema`
- Prompts (phase 2): `slice-and-print`, `optimize-for-time`, `compare-layer-heights`
- `send_to_printer(job_id, host_id, {start})` (phase 3) – **start=true only with explicit user approval**

The audit log planned for phase 2 is already in phase 1 (see §5).

## 5. Security

- **Authentication**: bearer token (`MCP_TOKEN` in the environment); without a token `/mcp` is disabled.
  Optionally an OAuth resource server per the MCP specification for cloud clients.
- **Network**: MCP only on the LAN or behind a reverse proxy with TLS; CORS/origin check against DNS rebinding.
- **Dangerous actions**: starting a print, deleting in the library, deleting presets → tool annotation
  `destructiveHint`/`openWorldHint`, plus a server-side confirmation requirement (`confirm: true`)
  and an audit log (`/data/audit.log`: who, when, which tool, which parameters).
- **Resource limits**: projects per client limited, jobs through the existing queue (MAX_JOBS),
  upload sizes as today; paths via `resolveLibraryPath` (no escaping the library).
- **No secrets to the LLM**: printer API keys are never returned (as in the REST API).

### 5.1 Setting guardrails (S1-a, T-025)

A human who later sends a job does not read its G-code, so the MCP channel may not prepare whatever
the slicer would accept. `set_settings` (and `quick_settings`, which writes through the same path)
checks every value against two rules in `shared/src/safety/mcpPolicy.ts`:

**Allowlist** – only process and material options. Never:

- anything in the printer scope (`start_gcode` lives in the print preset, `z_offset`, `bed_shape`,
  `max_print_height`, `nozzle_diameter`, `machine_*` and the rest of the printer scope are closed);
- G-code and script text: `multiline` options, every `*_gcode` key, `post_process`;
- free text and coordinates (`string`, `strings`, `point`, `point3`) – including `notes`,
  `custom_parameters_*` and `gcode_substitutions`;
- the server-only keys of SEC-1 and `output_filename_format`.

The print list is derived from the option categories the installed slicer reports
(Layers and Perimeters, Infill, Support material, Skirt and brim, Speed, Ironing, Fuzzy Skin,
Extrusion Width, Wipe options) plus a reviewed list of harmless `Misc` keys (skirt, travel, vase,
draft shield, seam gap, ooze prevention). The material list is explicit and short: temperatures, fan
speeds and cooling, retraction, `extrusion_multiplier`, `filament_max_volumetric_speed` – no
diameter, density, cost or purge tuning. Against PrusaSlicer 2.9.6 that is 121 print options and 29
filament options; the printer scope has none.

**Bands** – a bounded step away from the value the resolved preset already has:

| Key(s)                                                                                     | Band                                                                 |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `temperature`, `first_layer_temperature`, `bed_temperature`, `first_layer_bed_temperature` | ±25 °C                                                               |
| motion and volumetric speeds (`*_speed`, except fan speeds)                                | ×0.5–×1.5 (an absolute value absolutely, a percent value as percent) |
| `extrusion_multiplier`                                                                     | ±0.1                                                                 |
| `filament_retract_length`                                                                  | ±1 mm                                                                |

Per-extruder vectors are compared element by element, so `215,285` with a `215,215` preset fails on
the second element. `0` – "off" or "auto" for the slicer – stays allowed where PrusaSlicer means
that, and a preset value of `0` gives no band to measure against. A value the schema accepts but the
band does not is refused; there is no automatic clamping, so the model learns the limits instead of
silently printing something else.

**Rejection** – the check runs against the would-be config, so one failing key rejects the whole
call: nothing is applied, and the tool error lists every issue as
`key: value – reason (allowed …)`. `check_settings` answers the same list without applying anything,
so an agent can probe a value first. Both accepted and rejected calls go to the audit log (§5).

## 6. Phased implementation

| Phase | Content                                                                                                                                                                                                                                                                                | Effort   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0     | Headless import (3MF mesh reader, normalization, server-side arrange), project store with TTL                                                                                                                                                                                          | 2–3 days |
| 1     | MCP endpoint (`@modelcontextprotocol/sdk`, Streamable HTTP, token auth), "discover" + "slice" tools (list_*, create_project, add_model, set_settings, quick_settings, slice, get_job), audit log – **done (T-006)**; setting guardrails (S1-a) and `check_settings` – **done (T-025)** | 2 days   |
| 2     | Object tools (transform, modifiers, height ranges), resources, prompts                                                                                                                                                                                                                 | 2 days   |
| 3     | `send_to_printer` with confirmation, variant comparison, thumbnail rasterizer                                                                                                                                                                                                          | 2 days   |
| 4     | stdio variant as npm package (`webslicer-mcp`), docs, examples for Claude Desktop / Claude Code / Home Assistant                                                                                                                                                                       | 1 day    |

Tests: unit tests of the tool handlers against the existing logic, integration test with the MCP
Inspector (`npx @modelcontextprotocol/inspector`) and an E2E script that runs a complete agent workflow
(library → project → slice → evaluation) against the container.

## 7. Open questions

- Should the chat panel in the WebSlicer UI become part of the project (own LLM access in the server)
  or do agents stay external?
- Multi-user: projects per token or globally visible?
- Thumbnails in headless mode: is a simple rasterizer acceptable or is browser quality required?

## 8. Recommendation

Start with phases 0 and 1: they deliver the most value (an agent can slice from the library and
evaluate) at manageable risk, since only read-only tools and the existing job queue are involved.
Starting prints via an agent only in phase 3, after the hardware test of the upload function.
