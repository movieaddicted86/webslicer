# WebSlicer

A full-featured 3D printing slicer as a web application. WebSlicer runs the **original PrusaSlicer
engine** (CLI) in the backend and brings plater, settings, profiles, G-code preview and printer upload
to the browser. Runs as a Docker container or natively in a Proxmox LXC.

![Stack](https://img.shields.io/badge/engine-PrusaSlicer%202.9.x-orange) ![Node](https://img.shields.io/badge/node-%E2%89%A520-green) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Features

- **3D plater** (Three.js): import STL / OBJ / 3MF / AMF (drag & drop), multiple objects,
  move / rotate / scale (gizmo + numeric input), **place on face** (key F), arrange, duplicate,
  build-volume check, extruder assignment, **per-object settings** (overrides like in PrusaSlicer).
- **Support, seam and MMU painting**: paint enforcers and blockers or the extruder directly onto the model
  (keys L / P, adjustable brush radius, undo), stored like PrusaSlicer as per-triangle attributes in the 3MF.
- **Undo/redo** in the plater, **vendor bed** with the model and texture of the selected printer.
- **Volumes** like in PrusaSlicer: **modifiers** (regions with their own settings, e.g. 100 % infill),
  **support enforcers / blockers**, **negative volumes** (cut-outs) and additional **parts** as box,
  cylinder, sphere, slab or from a mesh file; stored in the 3MF and restored on import.
- **Height ranges**: Z ranges of an object with their own layer height and any other setting
  (variable layer height), like the height range modifiers in PrusaSlicer.
- **All slicing options** of the installed PrusaSlicer version: the option schema is generated at
  runtime from `prusa-slicer --help-fff/--help-sla` and sorted into the familiar
  *Print / Filament / Printer Settings* tabs with pages and groups (Simple / Advanced / Expert mode,
  search, modified markers, reset).
- **Vendor profiles**: all PrusaSlicer vendor bundles (Prusa, Creality, Anycubic, … 35 vendors) including
  inheritance, compatibility conditions (`compatible_printers_condition`), printer/nozzle variants,
  default filaments. User presets are stored as PrusaSlicer-compatible `.ini` files.
- **Slicing** with the real engine (FFF and SLA), progress via server-sent events, job queue with
  parallel jobs.
- **G-code preview**: toolpaths coloured by feature type (PrusaSlicer colours) or as colour print, layer
  slider (top/bottom), travel moves, legend with lengths, print time / filament usage / cost.
- **Colour change, pause and custom G-code at a layer**: add them at the top slider position like the
  "+" on PrusaSlicer's vertical slider (M600 / pause with message / any G-code), markers on the slider,
  automatic re-slice, stored in the 3MF project.
- **Export**: G-code (also binary `.bgcode`), project as 3MF (with all settings, opens directly in
  desktop PrusaSlicer), config bundle `.ini`.
- **Physical printers**: upload (optionally starting the print) to **PrusaLink**, **OctoPrint** and
  **Klipper/Moonraker** (Mainsail/Fluidd), also over HTTPS with self-signed certificates.
- **Thumbnails in G-code**: the browser renders previews in the sizes and formats of the printer profile
  (PNG, JPG, QOI for Prusa displays), the server embeds them into the G-code. Printer displays and
  Mainsail/Fluidd/OctoPrint then show the print with an image.
- **Multi-extruder / MMU**: filament preset per extruder, wipe tower settings, extruder count in the
  printer preset.
- **File library**: a mounted directory (`/library`, e.g. a NAS share) with STL/OBJ/3MF/AMF, projects
  and G-code. Files can be browsed and opened in the browser, projects stored as 3MF and finished G-code
  dropped there, without uploading through the browser.
- **Autosave**: the plater is saved automatically as a project and offered for restore after a reload
  or browser crash.
- Multi-user capable on the LAN, no client installation, also works on tablets.

> Not included yet (see TODO.md): cut tool, text/SVG embossing, continuous layer-height profile,
> measurement tool. The slicing result is otherwise identical to PrusaSlicer because the same engine
> is used.

## Quick start with Docker

```bash
docker compose up -d
# → http://localhost:8080
```

Or without Compose:

```bash
docker build -t webslicer .
docker run -d --name webslicer -p 8080:8080 -v webslicer-data:/data -v /path/to/models:/library webslicer
```

`/data` holds settings, profiles, printers and jobs; `/library` is the file library you can mount on a
folder or NAS share (default in Compose: `./library`).

On first start the *Printers* dialog opens: pick vendor and printer model/nozzle (or create a *Custom
printer*). Then drag a model into the 3D view and click **Slice now**.

### Build arguments / environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PRUSASLICER_VERSION` (build arg) | `2.9.6` | PrusaSlicer version |
| `PRUSASLICER_URL` (build arg) | – | Custom AppImage URL (overrides version/arch) |
| `PORT` | `8080` | HTTP port |
| `DATA_DIR` | `/data` | Presets, models, jobs, printer list, autosave |
| `LIBRARY_DIR` | `/library` (Compose) or `$DATA_DIR/library` | File library for STL/3MF/G-code, meant to be mounted |
| `MAX_JOBS` | `2` | Parallel slicing jobs |
| `MAX_UPLOAD_BYTES` | `524288000` | Maximum upload size per model |
| `JOB_RETENTION` | `50` | Jobs (G-code) kept |
| `SLICE_TIMEOUT_MS` | `3600000` | Timeout per slicing job |
| `PRUSASLICER_BIN` | `/opt/prusaslicer/AppRun` | Path to the slicer binary |
| `PRUSASLICER_RESOURCES` | auto | Path to the `resources` directory (profiles) |

Example: `docker build --build-arg PRUSASLICER_VERSION=2.9.5 -t webslicer .`

### Where does the PrusaSlicer binary come from?

Prusa Research no longer publishes Linux binaries since 2.9.0 (Flatpak only). The image therefore uses
the maintained community AppImages built from the unmodified PrusaSlicer sources:

- x86_64: <https://github.com/gneiss15/PrusaSlicer.AppImage>
- arm64: <https://github.com/davidk/PrusaSlicer-ARM.AppImage>

With `PRUSASLICER_URL` any other AppImage (e.g. your own build) can be used; with `PRUSASLICER_BIN`
also a self-compiled binary mounted as a volume.

## Installation on Proxmox VE (LXC)

Run on the Proxmox host as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/movieaddicted86/webslicer/main/proxmox/webslicer-lxc.sh)"
```

The script asks for container ID, hostname, disk, CPU, RAM, bridge, IP and storage (whiptail),
downloads the Debian 12 template, creates an unprivileged LXC, installs Node.js 22 and PrusaSlicer,
builds WebSlicer and sets up the systemd service `webslicer`. The URL is printed at the end.

Non-interactive:

```bash
CTID=120 HOSTNAME=webslicer DISK=12 CORES=4 RAM=4096 STORAGE=local-lvm IP=dhcp YES=1 \
  bash proxmox/webslicer-lxc.sh
```

When run from a local checkout (e.g. copied to the host with `scp`), the local sources are pushed into
the container instead of being fetched from GitHub. Repository (`WEBSLICER_REPO`) and branch can be set
via environment variables.

Recommended resources: 2–4 cores, 3–4 GB RAM (large models need more), 10 GB disk (PrusaSlicer
extracts to ≈ 1 GB).

Useful commands inside the container:

```bash
systemctl status webslicer
journalctl -u webslicer -f
bash /root/webslicer-install.sh      # update to the current branch / a new PrusaSlicer version
```

The installer `proxmox/install.sh` also works on any Debian 12/13 or Ubuntu 22.04+ (VM, bare metal).

### Alternative: Docker inside the LXC

If you prefer Docker inside the LXC: create the container with `nesting=1`, install Docker and run
`docker compose up -d` in the repository.

## Development

```bash
npm install
npm run dev          # Vite (5173, proxy → API) + server (8080, tsx watch)
npm run build        # web/dist + server/dist
npm test             # server tests
```

For local development PrusaSlicer must be reachable (`PRUSASLICER_BIN`); on Windows the
`prusa-slicer-console.exe` of the desktop installation is found automatically.

### Architecture

```
web/      React + Three.js + Zustand (Vite)      → plater, settings UI, G-code preview (web worker)
server/   Node 22 + Express
  slicer/cli.ts        invoking prusa-slicer
  slicer/schema.ts     option schema from --help-fff/--help-sla + curated tab layout
  slicer/bundles.ts    vendor bundles (resources/profiles/*.ini) with inheritance
  slicer/condition.ts  evaluation of compatible_*_condition
  slicer/presets.ts    system/user presets, installed printers
  slicer/threemf.ts    STL parser, 3MF writer (transforms, volumes, paint, height ranges)
  jobs.ts              job queue, progress (SSE), G-code statistics
  printers.ts          PrusaLink / OctoPrint / Moonraker upload
proxmox/  LXC helper (host) + installer (container)
```

Slicing flow: the browser loads the model, normalizes the geometry and uploads it as STL. On slicing
the server builds a 3MF from all objects + transforms, writes the merged configuration
(print + filament(s) + printer) as `config.ini` and calls
`prusa-slicer --export-gcode --load config.ini --dont-arrange model.3mf`.

### API (excerpt)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/schema` | option schema + layout |
| GET | `/api/vendors` | vendors & printer models |
| POST | `/api/presets/:type/list` | presets (with compatibility) |
| GET/PUT/DELETE | `/api/presets/:type/:name` | read preset / save as user preset / delete |
| POST | `/api/models` | upload STL (body = binary STL) |
| POST | `/api/slice` | create job → `202 {id}` |
| GET | `/api/jobs/:id/events` | progress (SSE) |
| GET | `/api/jobs/:id/gcode` | result (`?download`) |
| POST | `/api/jobs/:id/send` | upload to a physical printer |
| POST | `/api/export/3mf` | project 3MF |
| GET | `/api/library` | file library |

## More documents

- [CHANGELOG.md](CHANGELOG.md) – versions
- [docs/UAT.md](docs/UAT.md) – acceptance test plan, [docs/UAT-Report.md](docs/UAT-Report.md) – results
- [docs/Feature-Comparison.md](docs/Feature-Comparison.md) – PrusaSlicer ↔ WebSlicer feature inventory with priorities
- [docs/MCP-Concept.md](docs/MCP-Concept.md) – concept for controlling WebSlicer through LLM agents (MCP)
- [TODO.md](TODO.md) – roadmap

## License

WebSlicer is licensed under the AGPL-3.0, like PrusaSlicer. PrusaSlicer is © Prusa Research; WebSlicer
is an independent project and not affiliated with Prusa Research.
