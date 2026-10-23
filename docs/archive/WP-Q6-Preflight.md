# Work package Q6 – G-code preflight hardening (printer safety)

|            |                                                                                                                                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q6-preflight` (branch `feature/q6-preflight`)                                                                                                                                                                                                                            |
| Findings   | N2, N3, N4 (subset)                                                                                                                                                                                                                                                       |
| Base       | `main` at commit `eb00fa4` or later                                                                                                                                                                                                                                       |
| Read first | CONVENTIONS.md, CODING-GUIDELINES.md, this file                                                                                                                                                                                                                           |
| Estimate   | 3 phases, one commit each                                                                                                                                                                                                                                                 |
| Allowed    | `shared/src/safety/{gcodePreflight,configLimits}.ts`, `server/src/slicer/gcodePreflight.ts`, `server/src/services/{sendGate,configMerge,slice}.ts`, `server/src/slicer/ini.ts`, `server/src/slicer/threemf/read.ts`, `server/src/validation/slice.ts`, tests next to them |

## 1. Goal

This is printer protection, not network security: the preflight and the configuration limits stop
G-code that can damage the machine or its EEPROM. Three gaps let such G-code through.

## 2. Acceptance criteria

**N2 – carriage return hides commands (verify first).**
`GcodePreflight.push` splits only on `\n`; a lone `\r` in a custom G-code value
(`escapeIniValue` escapes `\n` but not `\r`; the 3MF config reader keeps it) can hide `M500` behind
`G28`. Marlin treats `\r` as a line end.

- AC-1.1 Phase 1 starts with a reproduction: a print preset whose `start_gcode` contains
  `G28\rM500`, sliced for real in Docker. Record whether the `\r` reaches the G-code file.
- AC-1.2 Regardless of the result: the preflight splits on `/\r\n|\r|\n/`. A config value with a
  lone `\r` (not part of `\r\n`) is rejected with 400 naming the key – in the slice validation and,
  as a last line, in `serializeIni` (throws, like `assertValidConfigKey`). Tests: `"G28\rM500"`
  yields `gcode.forbidden_command`; a preset value with a lone `\r` → 400.
- AC-1.3 `M 500` (space after the letter, accepted by Marlin) is recognised as `M500`.

**N3 – limits not applied where they matter.**

- AC-2.1 The stored preflight result only holds findings above the global 450/150 °C ceilings, so
  an `M104 S300` is never stored. Extend the result with the **maximum hotend and bed
  temperatures seen** in the file; `sendGate.preflightIssues` compares them with the target
  printer's `safety` (`maxHotend`, `maxBed`). Results without these fields (older version) are
  re-scanned. Test: job with `M104 S300` in custom start G-code, printer limit 260 → send blocked
  with `send.printer_limit`.
- AC-2.2 `checkConfigLimits` (called from `services/slice.ts` `validateConfigLimits`) runs on the
  **merged** config (after `mergeConfigs`), so
  `temperature`/`bed_temperature`/`nozzle_diameter` coming from a print or printer config are
  checked too. Test: filament without `temperature`, printer config with `temperature = 999` → 400.
- AC-2.3 Per-object and per-range `layer_height` overrides are checked with the same rule.

**N4 subset – missing dangerous commands.**

- AC-3.1 Block: `M121` (endstops off), `M302` (cold extrusion allowed), Klipper `SAVE_CONFIG`.
- AC-3.2 Temperature ceiling also for `M303` (PID autotune target `S`), `M141`/`M191`, Klipper
  `SET_HEATER_TEMPERATURE … TARGET=`, RRF `G10 … S`/`M568 … S`.
- AC-3.3 Every rule has a positive and a negative unit test; `server/scripts/limits-sweep.ts` over
  all bundled 2.9.6 system presets still reports 0 blocking findings.

## 3. Binding decisions

- Rules stay data-driven in `shared/src/safety/`; no per-printer-firmware plugins.
- Keep the existing severity model (block / warn) and the override-with-reason path.
- `M906`/`M907` stay warnings (PrusaSlicer's own MK3S presets emit them).

## 4. Phases

1. N2 reproduction + line splitting + `M 500` (AC-1.x). Commit: `Safety: preflight splits on every line end (q6-preflight)`
2. N3 limits on the merged config and per target printer (AC-2.x). Commit: `Safety: limits on the merged config and the target printer (q6-preflight)`
3. N4 subset rules, limits sweep, CHANGELOG, handover (AC-3.x). Commit: `Safety: more dangerous commands in the preflight (q6-preflight)`

## 5. Pitfalls

- The scanner reads the file in chunks: a `\r` at the end of one chunk and `\n` at the start of the
  next is **one** line end, not two (line numbers in findings must stay right).
- Bump `PREFLIGHT_VERSION` so results stored by the old rules are re-scanned.

## 6. Review checklist

- [ ] Reproduction result for N2 documented (does `\r` survive PrusaSlicer?).
- [ ] Target-printer limits applied at send time.
- [ ] Limits sweep: 0 blocking findings on system presets.
