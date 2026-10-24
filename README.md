# WebSlicer

A full-featured 3D printing slicer in the browser. WebSlicer runs the **original PrusaSlicer engine**
(CLI) on the server and brings the plater, settings, profiles, G-code preview and printer upload to
any browser – on a PC, a tablet or the workshop laptop.

![WebSlicer plater](docs/images/hero.png)

![Stack](https://img.shields.io/badge/engine-PrusaSlicer%202.9.x-orange) ![Node](https://img.shields.io/badge/node-%E2%89%A522-green) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue)

## Features

- **3D plater** (Three.js): import STL / OBJ / 3MF / AMF / STEP, move / rotate / scale, place on face,
  arrange, duplicate, instances, mirror, merge, cut, per-object settings and a tool strip that floats at
  the top centre of the scene, with the open tool's controls and its key hints in the context panel. A
  rail on the far left holds Slicing, Library, Printers, Preferences and About, and the slim top bar's
  menu carries import and the export list; the settings open from the cog of each preset row.
- **Volumes and height ranges** like PrusaSlicer: modifiers, support enforcers/blockers, negative
  volumes, extra parts, and variable layer height.
- **All slicing options** of the installed PrusaSlicer, sorted into the familiar Print / Filament /
  Printer tabs with Simple / Advanced / Expert mode, search and modified markers.
- **Vendor profiles**: all PrusaSlicer bundles (35 vendors) with inheritance and compatibility rules;
  user presets are PrusaSlicer-compatible `.ini` files.
- **Slicing** with the real engine (FFF and SLA), progress over server-sent events and a job queue.
- **G-code preview**: toolpaths by feature or colour scheme, layer and move sliders, legend with time
  and filament, colour change / pause / custom G-code at a layer.
- **Export**: G-code (also binary `.bgcode`), project 3MF (opens in desktop PrusaSlicer), config `.ini`.
- **Printers**: upload to PrusaLink, OctoPrint and Klipper/Moonraker, guarded by a preset-match gate,
  **G-code preflight** and configuration limits (see [docs/safety.md](docs/safety.md)).
- **File library** on a mounted folder or NAS, and **autosave** that restores the plater after a reload.
- **MCP endpoint** at `/mcp`, so an assistant can browse presets and library, build a project and slice
  it – see [docs/mcp.md](docs/mcp.md).

## How it is built

- `web/` – React 19, three.js and Zustand: plater, settings, G-code preview.
- `shared/` – pure TypeScript shared by web and server: API contract types, geometry, packing.
- `server/` – Node 22 and Express: routes → services → the PrusaSlicer CLI, slice jobs over SSE,
  presets, library, printer upload and the `/mcp` endpoint.
- `e2e/` – the Playwright suite, `proxmox/` – the LXC installer, `docs/` – the guides.

The layout in detail is in [docs/development.md](docs/development.md).

Feature-by-feature comparison with PrusaSlicer: [docs/Feature-Comparison.md](docs/Feature-Comparison.md).
Not included yet (see [TODO.md](TODO.md)): text/SVG embossing, a measurement tool, a G-code viewer for
files from the library. The slicing result is otherwise identical to PrusaSlicer because the same engine
is used.

## Quick start

Docker Compose:

```bash
docker compose up -d
# → http://localhost:8080
```

Proxmox VE (LXC), on the host as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/movieaddicted86/webslicer/main/proxmox/webslicer-lxc.sh)"
```

On first start pick your printer in the _Printers_ dialog, drag a model into the 3D view and click
**Slice now**. Installation details (Docker without Compose, reverse proxy, Proxmox advanced mode,
PrusaSlicer pinning): [docs/installation.md](docs/installation.md). All environment variables:
[docs/configuration.md](docs/configuration.md).

**Updates.** WebSlicer never updates itself, but it tells you when the repository has moved on: the
server compares its build commit (`GIT_COMMIT`, passed by Compose/CI/the Proxmox installer) with the
head of your branch once a day, and a dismissible chip next to the rail's **About** item plus the About
dialog link to the new commits or release. Set `WEBSLICER_UPDATE_CHECK=off` to switch the check – and
every outbound request – off. Details: [docs/installation.md#update-notice](docs/installation.md#update-notice).

## A quick tour

The plater with the rail on the far left, the slim top bar, the object list column next to the scene
and the context panel on the right. The object list card folds on its own and the whole column folds to
a narrow strip; its width is draggable. The tool strip floats at the top centre of the scene: it opens
every tool (move, rotate, scale, place on face, arrange and its settings, painting, cut, variable layer
height), carries delete, add/remove instance and the **Prepare | Preview** switch, and turns the
trailing groups into an overflow menu when the view is narrow. The open tool's controls take over the
context panel, with its one primary action pinned at the bottom and the mouse and key hints below the
controls. The context panel otherwise follows the selection: with nothing on the plater it shows the
printer card, the preset rows, the quick settings and the Slice button; selecting an object adds its
**Transform**, **Settings**, **Parts** and **Layer ranges** cards, and the footer keeps the destination
and Slice in view. The **Menu** in the top bar holds import models and presets and the **Export** list
(project 3MF, settings, presets bundle, G-code, save to library); the rail holds the app's places and
dialogs, **Preferences** the visibility mode and the panel layout reset, and each preset row's cog the
print/filament/printer settings; **hide panels** gives the 3D view the full width.

![The plater](docs/images/plater.png)

The cut tool as an example of a tool panel – plane height and tilt, keep upper/lower/both, and the cut
runs through the PrusaSlicer CLI. Its controls sit in the context panel; the hints at the bottom say
what the mouse buttons and Esc do.

![The cut tool](docs/images/cut-tool.png)

Print settings are the full PrusaSlicer option set, grouped into pages; the mode switch decides how many
options are shown.

![Print settings](docs/images/settings.png)

The G-code preview with toolpaths by feature, the layer slider, layer codes and the legend with print
time and filament per feature; the **Sliced info** and **Legend** cards sit in the left column.

![G-code preview](docs/images/preview.png)

The file library can be a shared folder or a NAS mount: models, projects and finished G-code.

![File library](docs/images/library.png)

## Documentation

- [docs/features.md](docs/features.md) – what the plater, settings, preview and printer support do
- [docs/installation.md](docs/installation.md) – Docker, Proxmox LXC, updates, model library, PrusaSlicer pinning
- [docs/configuration.md](docs/configuration.md) – all environment variables in one table
- [docs/mcp.md](docs/mcp.md) – MCP setup, clients and tools
- [docs/development.md](docs/development.md) – repo layout, commands, tests and CI
- [docs/safety.md](docs/safety.md) – configuration limits and G-code preflight
- [docs/Feature-Comparison.md](docs/Feature-Comparison.md) – PrusaSlicer ↔ WebSlicer feature inventory
- [docs/MCP-Concept.md](docs/MCP-Concept.md) – the concept behind the agent endpoint
- [docs/UAT.md](docs/UAT.md) – acceptance test plan
- [CHANGELOG.md](CHANGELOG.md) – versions, [TODO.md](TODO.md) – roadmap
- [docs/archive/](docs/archive/) – finished reports and work packages, kept for traceability

The screenshots above are generated: `npm run docs:screenshots` drives the Docker image with Playwright
and refreshes `docs/images/`.

## Contributing

Issues and pull requests are welcome – start with [CONTRIBUTING.md](CONTRIBUTING.md). It links the
binding rules for code, tests and commits and lists the commands, including the E2E suite.

## License

WebSlicer is licensed under the **GNU Affero General Public License, version 3 or later** (`LICENSE`),
like PrusaSlicer itself. PrusaSlicer is © Prusa Research; WebSlicer is an independent project and not
affiliated with Prusa Research. The UI icons are PrusaSlicer's artwork (AGPL-3.0), copied and
recoloured. The bundled JavaScript dependencies, the icon source and the PrusaSlicer source link are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
