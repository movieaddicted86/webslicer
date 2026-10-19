# Changelog

## Unreleased

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
