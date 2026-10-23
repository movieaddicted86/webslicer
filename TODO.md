# WebSlicer – To-do / Roadmap

Based on [docs/Feature-Comparison.md](docs/Feature-Comparison.md) (PrusaSlicer 2.9 ↔ WebSlicer).
Priority by frequency of use in everyday printing and PrusaSlicer parity.

## P1 – required for version 1.0 (in this order)

1. [x] **Colour change / pause / custom G-code at a layer** via the preview slider (M600, colour print preview)
2. [x] **Preview colour schemes**: height, width, speed, fan speed, temperature, volumetric flow, layer time
       (linear/logarithmic), tool; gradient legend with value range
3. [x] **Instances**: set number, fill bed, instances in the object list (shared geometry, own transform)
4. [x] **Mirror** X/Y/Z in the manipulation panel
5. [x] **Split to objects / parts** (separate connected shells)
6. [x] **Unsaved-changes dialog** on preset switch: transfer / save / discard

## MCP (approved 2026-10-19, docs/MCP-Concept.md) – scheduled right after T-004

- [x] Phase 0 – headless model import, server-side plater/arrange, project store (T-005)
- [x] Phase 1 – `/mcp` endpoint with per-user tokens, discover + slice tools, audit log (T-006)
- [x] Phase 1 safety – setting allowlist, relative bands, `check_settings`, rejected calls in the audit log (T-025)
- [ ] Phase 2 – object tools, resources, prompts (within P2)
- [ ] Phase 4 – stdio package `webslicer-mcp`, docs and client examples (within P2)
- [ ] Phase 3 – `send_to_printer` with confirmation, variants, thumbnails (after the PrusaLink/OctoPrint hardware test)

## P2 – important afterwards

- [x] Preview: horizontal slider and view options (retractions, seams, wipe, tool/colour changes, shells) and tool marker
- [x] Preview: time per feature, slicer warnings (T-007)
- [x] G-code preflight before sending: forbidden commands, absurd temperatures, moves before homing (S1-c, T-031)
- [x] Configuration limits while editing: server checks at the field, Slice disabled on a block (S1-e, T-041)
- [x] STEP import through the CLI (`--export-stl`, T-009)
- [x] Merge objects; object info (volume, manifold check), rename (T-042)
- [x] Arrange with settings (spacing, rotation, alignment) and "arrange selection" (T-043)
- [x] Cut tool (cut plane, via the CLI, T-044) – connectors (dowels/buttons) still open
- [x] Continuous layer-height profile (adaptive, smoothing, brush, T-045)
- [ ] Rename preset; config bundle import/export; import config from G-code
- [ ] Update vendor profiles online (PrusaSlicer-settings)
- [ ] Extend the configuration wizard (filaments per vendor, temperatures)
- [x] Camera: views (iso/top/front/…), orthographic, zoom to selection
- [x] Object toolbar with real SVG icons (lucide), grouped, 18 px, readable tooltips (T-036)
- [x] Tool framework: left tool bar at the 3D view + one panel per tool, registry-driven (T-046)
- [ ] Printer status / upload queue (needs hardware test)
- [x] Session survives reload and browser close: automatic restore, flush on hide/close, "Start empty" (T-035)
- [ ] Localized UI (German, …)
- [ ] G-code viewer for files from the library; bgcode conversion and thumbnails in bgcode

## P3 – convenience

- [ ] Measure tool, text/SVG embossing, shape gallery (put resources/shapes back into the image)
- [ ] Brush options (smart fill, bucket fill, height range), world/local gizmo, rectangle selection, copy/paste
- [ ] Compare presets, detach from system, global search, undo history, preferences
- [ ] Simplify model, unit conversion, reload from disk, recent projects
- [ ] Multiple beds, purging volumes dialog, stealth time, G-code text window, collapsible sidebar
- [ ] More print hosts (Prusa Connect, Duet, Repetier, Obico), physical printers linked to presets
- [ ] SLA: support point editor, hollowing editor, SLA preview
- [ ] Mobile view: tablet fully usable (collapsible sidebar, touch-sized controls, buttons for every
      shortcut), phone as companion (library → preset → slice → preview → send); planned as 4–5 tasks
      M-1 layout breakpoints, M-2 touch interaction, M-3 mobile preview with performance limits,
      M-4 phone companion flow, M-5 device tests and UAT
- [ ] Docker image stage 2: own PrusaSlicer build without GUI (≈ 300–400 MB)
- [ ] Library: thumbnails, search, sorting

## P4 – later or not planned

- [ ] Adopt TypeScript 7 once typescript-eslint supports it; until then `tsgo` may be tried for
      `typecheck` only (Q1 pins `typescript` to `~6.x`: TS 7 has no JavaScript API, so type-aware
      linting cannot run on it)
- [ ] User management, in stages: A) document login via a reverse proxy (Authentik/Authelia/
      Nginx Proxy Manager) – no code; B) built-in local users (scrypt, session cookie, roles
      admin/user, API/MCP tokens per user, per-user presets/library/printers/jobs/autosave,
      migration of existing data to the first admin); C) OIDC single sign-on on top of B
- Netfabb/Microsoft repair, firmware flasher, Printables integration, toolpaths as OBJ, gantry visualization, configuration snapshots

## Deferred – waiting for beta testers with the hardware (do not schedule)

- PrusaLink / OctoPrint upload test (Moonraker is done, see "Needs you")
- MCP phase 3 `send_to_printer` with confirmation, variants, thumbnails
- Printer status / upload queue (P2)
  These three stay open until a beta with testers who own the printers runs them; no other task waits on
  them (`.ai/ROADMAP.md`, "Deferred").

## Done

- [x] Slicing core, profiles, settings tabs (modes), quick settings, preview by feature type, thumbnails
- [x] Volumes (modifiers, support enforcers/blockers, negative, parts), height ranges, support/seam/MMU painting
- [x] Place on face, undo/redo, vendor bed, library, autosave, project save/load
- [x] Print hosts PrusaLink/OctoPrint/Moonraker with TLS option, Docker, Proxmox, UAT 1.0.0-rc.2

## Needs you (Robert)

- [x] Upload to a real printer – Klipper/Moonraker tested 2026-10-19 (PrusaLink / OctoPrint untested, on hold:
      no hardware available)
- [x] Proxmox helper on a real PVE host – tested 2026-10-19
- [x] Re-test the reworked Proxmox helper (Default and Advanced settings) – tested 2026-10-19
- [x] Approve the MCP integration per docs/MCP-Concept.md – approved 2026-10-19

## Done – T-034

- [x] Plate checks before slicing: bed polygon, skirt/brim, toolpath conflicts, sequential printing
      clearance in the slice panel, blocking "Slice now" (`.ai/reports/T-034.md`)
- [ ] Follow-up: exact skirt geometry (PrusaSlicer's convex-hull offset instead of the union box)
- [ ] Follow-up: sequential-print collision with the gantry height (`extruder_clearance_height` in Z)
