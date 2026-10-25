# Safety checks before and around slicing

Two checks keep a preset or an agent from producing a file that damages a printer. Both live in
`shared/` and run in the server and in the UI; the same code decides in the browser and on upload, so
the two cannot disagree.

## Configuration limits

The settings that produce a file are checked before the slicer runs
(`shared/src/safety/configLimits.ts`, `config.*` rules). Two levels:

| rule                              | severity | finding                                                              |
| --------------------------------- | -------- | -------------------------------------------------------------------- |
| `config.hotend_limit`             | block    | `temperature`/`first_layer_temperature` outside 0 or 150–450 °C      |
| `config.bed_limit`                | block    | `bed_temperature`/`first_layer_bed_temperature` outside 0–150 °C     |
| `config.chamber_limit`            | block    | `chamber_*` outside 0–100 °C                                         |
| `config.nozzle_diameter`          | block    | `nozzle_diameter` outside 0.1–2.0 mm                                 |
| `config.layer_height`             | block    | not a number, ≤ 0, or more than 2× the nozzle diameter               |
| `config.filament_temperature`     | warn     | a hotend temperature outside the usual window of the `filament_type` |
| `config.filament_bed_temperature` | warn     | the same for the bed temperature                                     |

`0` means "off" in PrusaSlicer and is allowed wherever it is meaningful; `nil` elements of a
per-extruder vector and missing keys are skipped. The soft windows come from the material's own
profiles in PrusaSlicer 2.9.6 (PLA 175–255 °C/30–85 °C, PETG 205–290/55–115, ABS 225–280/65–120,
ASA 215–285/50–120, TPU 190–260/25–100, PA 230–300/40–130, PC 255–300/90–125); a value outside them
warns but slices, and the warning travels with the job into the preview. `server/scripts/limits-sweep.ts`
runs the same check over every bundled system preset (1763 print, 6948 filament, 1066 printer, 11 SLA
print and 482 SLA material presets in 2.9.6) and reports no finding.

The UI shows the same findings at the field (S1-e): a blocked value disables **Slice** with the
reason, a warning is listed in the slice panel.

## Plate checks

`shared/src/plater/plateCheck.ts` decides whether the plate may be sliced at all: every object (and
every instance) has to lie inside the bed polygon, the skirt and the brim have to fit around it, the
footprints of two objects may not overlap, and sequential printing keeps its extruder clearance.
`plate.outside`, `plate.too_tall`, `plate.skirt_outside`, `plate.brim_outside` and `plate.overlap`
block; `plate.clearance` warns.

The same file runs in the browser and in the server, so the two cannot disagree. In the browser the
store action `slice` asks it before it builds a request – that one seam covers the Prepare footer, the
Preview's own button, the automatic re-slice after a colour change and any scripted caller – and the
Preview lists the reasons beside its disabled button. On the server `POST /api/slice`, the project
slice and the MCP `webslicer.slice` tool compute the issues from the stored meshes and the request's
transforms and answer 400 `{ error, issues }` for a block. A result whose plate no longer passes the
checks can be read in the Preview but not exported, saved or sent until it does.

## G-code preflight

Custom start/end/layer G-code goes 1:1 into the output – that is the point of a custom G-code – so a
preset or an agent-written setting can ship commands that rewrite the printer's EEPROM or disable the
endstops. Once a job finishes, the server therefore reads the produced file once
(`shared/src/safety/gcodePreflight.ts`, in chunks – a 60 MB file takes about 3.6 s on the development
machine) and stores what it finds on the job. The rules of v1:

| rule                      | severity | finding                                                                                                                                                                                      |
| ------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcode.forbidden_command` | block    | `M500`, `M502`, `M211 S0`, `M92`, `M997`, `M851`, `M121`, `M302` (unconditional forms), Klipper `SAVE_CONFIG`                                                                                |
| `gcode.max_temp`          | block    | `M104`/`M109` above 450 °C, `M140`/`M190` above 150 °C, chamber above 100 °C, and the targets of `M303`, `M141`/`M191`, RRF `G10`/`M568`, Klipper `SET_HEATER_TEMPERATURE HEATER=… TARGET=…` |
| `gcode.no_homing`         | block    | a move with X/Y/Z before the first `G28`                                                                                                                                                     |
| `gcode.macro_before_move` | warn     | the same, but a printer macro (`PRINT_START`, …) came first and may home                                                                                                                     |
| `gcode.firmware_limit`    | warn     | `M201`/`M203`/`M204`/`M205` above the printer preset's `machine_max_*` (Normal)                                                                                                              |
| `gcode.motor_current`     | warn     | `M906`/`M907` – PrusaSlicer's own presets set the extruder current in start/end G-code                                                                                                       |
| `gcode.not_scanned`       | warn     | binary `.bgcode`, which v1 does not read                                                                                                                                                     |

Comments (`;…`, `(…)`), lowercase, `N`/checksum line numbers and all three Marlin line ends (`
`,
`
`, `
`) are understood, and `M 500` (a blank after the letter) is the command `M500`; a finding
names its line and shows the line itself. The result also records the highest hotend and bed
temperature the file asks for, so the send gate can compare it with the target printer's profile. The send gate merges the findings with the preset issues of S1-b: a
block refuses the upload with 409 until it is overridden with a reason (audited), a warning is shown
and only has to be confirmed when the print should start right away. The limits of the target machine
are S1-d: a physical printer can carry `safety.maxHotend`/`safety.maxBed` (the dialog has a
"PTFE hotend (max 240 °C)" preset), and the send gate compares the temperatures the job asks for with
them – `send.printer_limit` (**block**), overridable with a reason like any other block.

### The send endpoint

`POST /api/jobs/:id/send` answers **409** `{ error, issues }` when the job's printer preset is not the
one the host is linked to; repeating the call with `{ "override": true, "reason": "…" }` sends anyway
and records the override in `data/audit.log`.

The same 409 carries the findings of the **G-code preflight** (`shared/src/safety/gcodePreflight.ts`)
that scans the finished output once and stores the result on the job (`info.preflight`): a
`gcode.forbidden_command` (`M500`, `M502`, `M211 S0`, `M92`, `M997`, `M851`, `M121`, an
unconditional `M302`, Klipper `SAVE_CONFIG`), `gcode.max_temp` (a hotend above 450 °C, a bed above
150 °C or a chamber above 100 °C) or `gcode.no_homing` (a move before the first `G28`) blocks
and is overridable exactly like a preset mismatch, with the line behind the issue. `gcode.motor_current`
(`M906`/`M907`), `gcode.firmware_limit` (`M201`/`M203`/`M204`/`M205` above the printer preset's
`machine_max_*`), `gcode.macro_before_move` (a macro such as `PRINT_START` before the first move) and
`gcode.not_scanned` (binary `.bgcode`) only warn. Each issue is `{ rule, severity, message, line, text }`
(`line`/`text` only on preflight findings).

## Server-side command execution

The server never executes options as shell commands: SEC-1 removed that path, and SEC-2 closed the
`config`-key injection that bypassed it. Options the server drops before slicing are listed read-only
in the settings with the reason.
