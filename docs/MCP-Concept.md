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

| Option | Description | Assessment |
|---|---|---|
| **A. MCP endpoint in the WebSlicer server** (`/mcp`, Streamable HTTP) | `@modelcontextprotocol/sdk` in the Express server; tools call the internal functions directly (jobs.ts, presets.ts, library.ts). | **Recommended.** No second component, uses job queue, library and presets directly, one Docker image. Ideal for clients on the LAN (Claude Desktop, Home Assistant). |
| B. Separate MCP server (stdio) as npm package | Small process on the client machine that talks to WebSlicer's REST API. | Good for Claude Desktop / Claude Code over stdio without exposing the MCP endpoint on the network. Can later be derived from A (same tool definitions, different transport). |
| C. REST + OpenAPI only | Agents use the REST API via generic HTTP tools. | No MCP benefit (discovery, schemas, prompts, resources). Fallback only. |

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

| Route | Body | Answer |
|---|---|---|
| `POST /api/projects` | `{ printer, print, filaments?, owner? }` – a preset name or `{ name, config }` each | 201 with the project |
| `GET /api/projects/:id` | – | the project, 404 if unknown or expired |
| `POST /api/projects/:id/models` | `{ libraryPath, copies? }` (1–1000) | the project with the added objects |
| `POST /api/projects/:id/arrange` | – | the project with the instances packed on the bed |
| `POST /api/projects/:id/slice` | `{ binaryGcode?, outputName? }` | 202 with the job record (like `POST /api/slice`) |

Inputs are validated like `validateSliceRequest`; a bad library path, an unknown preset, too many
instances or objects that do not fit on the bed answer 400 with a message, an unknown project id 404.
3MF import puts the objects of the file at the file's positions (one object per `<object>`, one
instance per `<build><item>`); modifiers, parts and paint inside a 3MF are ignored in this phase.
Headless slices carry no thumbnails (a rasterizer is phase 3).

Projects expire 24 h after their last use (override with `PROJECT_TTL_HOURS`). The cleanup runs
together with `pruneModels` (on start and every 6 h) and deletes expired projects and the models only
they used; a model referenced by a live project is never pruned.

## 4. Tool catalogue (draft)

Naming convention `webslicer.<verb>_<object>`; all inputs as JSON Schema (zod).

**Discover**
- `list_printers()` → installed printer profiles (+ physical printers)
- `list_presets(type, printer?)` → compatible print/filament profiles with alias
- `get_option_schema(query?)` → options with label, type, default, tooltip (filtered)
- `list_library(path?)` / `search_library(text)` → models, projects, G-code

**Build a project**
- `create_project(printer, print_preset, filaments[])` → `project_id` (server-side state, TTL)
- `add_model(project_id, library_path | upload_id, {position?, rotation?, scale?, copies?})`
- `arrange(project_id)`, `transform_object(project_id, object_id, …)`, `place_on_face` (normal)
- `set_settings(project_id, {key: value}, scope: print|filament[i]|printer)` – validated against the schema
- `set_object_settings(project_id, object_id, {…})`, `add_modifier(...)`, `add_height_range(...)`
- `quick_settings(project_id, {supports, infill, brim})` – the three plater quick settings

**Slice and evaluate**
- `slice(project_id, {binary_gcode?, thumbnails?})` → `job_id`; progress via MCP notification
- `get_job(job_id)` → status, time, filament (mm/g/cost), layers, warnings from the slicer log
- `compare(project_id, variants[])` → table time/filament per variant (uses the job queue in parallel)
- `export_project(project_id, library_path)`, `export_gcode(job_id, library_path)`

**Printers**
- `list_print_hosts()`, `test_print_host(id)`
- `send_to_printer(job_id, host_id, {start: boolean})` – **start=true only with explicit user approval**
- later: `printer_status(host_id)` (roadmap: printer status)

**Resources (MCP resources)** – read-only: `webslicer://presets/{type}/{name}`, `webslicer://jobs/{id}/log`,
`webslicer://library/{path}` (3MF/G-code as binary resource), `webslicer://schema`.

**Prompts** – predefined flows: `slice-and-print`, `optimize-for-time`, `compare-layer-heights`.

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

## 6. Phased implementation

| Phase | Content | Effort |
|---|---|---|
| 0 | Headless import (3MF mesh reader, normalization, server-side arrange), project store with TTL | 2–3 days |
| 1 | MCP endpoint (`@modelcontextprotocol/sdk`, Streamable HTTP, token auth), "discover" + "slice" tools (list_*, create_project, add_model, set_settings, slice, get_job) | 2 days |
| 2 | Object tools (transform, modifiers, height ranges, quick settings), resources, prompts, audit log | 2 days |
| 3 | `send_to_printer` with confirmation, variant comparison, thumbnail rasterizer | 2 days |
| 4 | stdio variant as npm package (`webslicer-mcp`), docs, examples for Claude Desktop / Claude Code / Home Assistant | 1 day |

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
