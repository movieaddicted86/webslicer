/**
 * G-code preflight: does a finished print file do anything dangerous before it is sent?
 *
 * Custom G-code goes 1:1 into the output, so a preset or an agent-written setting can ship commands
 * that rewrite the EEPROM, disable the endstops or overheat – nothing looked at the produced file
 * before this. The scan is chunked (files are tens of MB) and its result is stored on the job with
 * `PREFLIGHT_VERSION`. `M906`/`M907` only *warn*: PrusaSlicer's own presets write `M907 E430` in
 * their start G-code, so a block would refuse every file for an MK3S. Rule table, the three Marlin
 * line ends and the reasons: `docs/safety.md`.
 */
import { unescapeStringCstyle } from '../values.js';
import type { ConfigPreflightScan, MaxTemperatures, PreflightIssue, PreflightResult, SendIssue, SendIssueSeverity } from '../types/jobs.js';

/** Version of the rule set; a stored result of another version is re-scanned. */
export const PREFLIGHT_VERSION = 2;

/** Wide typo catchers of Q-005 – narrow per-printer limits are S1-d. */
export const DEFAULT_HOTEND_LIMIT = 450;
export const DEFAULT_BED_LIMIT = 150;
/** The chamber catcher: PrusaSlicer's own profiles stay well below 70 °C (q6-preflight, N4). */
export const DEFAULT_CHAMBER_LIMIT = 100;
/** How many issues of one rule are kept (the counts keep the total). */
export const MAX_ISSUES_PER_RULE = 5;
/** A line longer than this cannot be a command; it is dropped instead of buffered (thumbnails are short). */
const MAX_LINE_LENGTH = 1024 * 1024;

export type { PreflightIssue, PreflightResult };

/** The severity of every rule of the rule set. */
export const PREFLIGHT_SEVERITY: Readonly<Record<string, SendIssueSeverity>> = {
  'gcode.forbidden_command': 'block',
  'gcode.motor_current': 'warn',
  'gcode.max_temp': 'block',
  'gcode.no_homing': 'block',
  'gcode.macro_before_move': 'warn',
  'gcode.firmware_limit': 'warn',
  'gcode.not_scanned': 'warn',
};

/** How the scan reads the machine: limits of the job's printer preset, ceilings, the issue cap. */
export interface PreflightOptions {
  /**
   * The job printer preset's config (or just its `machine_max_*` keys). A rule only fires when the
   * preset defines the limit – a preset without limits cannot be compared against.
   */
  machineLimits?: Readonly<Record<string, string | undefined>>;
  /** hotend ceiling in °C (`M104`/`M109`) */
  hotendLimit?: number;
  /** bed ceiling in °C (`M140`/`M190`) */
  bedLimit?: number;
  /** chamber ceiling in °C (`M141`/`M191`) */
  chamberLimit?: number;
  maxIssuesPerRule?: number;
}

/** How many issues the send gate reports, by severity. */
export interface PreflightSummary {
  blocking: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// reading the file
// ---------------------------------------------------------------------------

/** `;` comments and `(...)` comments are not commands; a `;` inside a bracket comment ends it. */
function stripComments(line: string): string {
  const semicolon = line.indexOf(';');
  const paren = line.indexOf('(');
  // the common case by far: neither a `;` nor a `(` in the line
  if (semicolon < 0 && paren < 0) return line;
  if (paren < 0 || (semicolon >= 0 && semicolon < paren)) return semicolon < 0 ? line : line.slice(0, semicolon);
  let out = '';
  let inParen = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (!inParen && c === ';') break;
    if (!inParen && c === '(') {
      inParen = true;
      continue;
    }
    if (inParen) {
      if (c === ')') inParen = false;
      continue;
    }
    out += c;
  }
  return out;
}

/** A line ends at CRLF, a lone CR or LF – Marlin treats all three as one line end. */
const LINE_END = /\r\n|\r|\n/;

/** A numeric parameter of a command: `S230`, `X3996.12`, `E-2`. */
const PARAM = /([A-Za-z])\s*(-?\d+(?:\.\d+)?)/g;

interface ParsedCommand {
  letter: 'G' | 'M';
  /** the command number; `M5000` is 5000, not 500 */
  number: number;
  /** the parameter text behind the command word (` X10 Y10 F3000`), parsed only when a rule needs it */
  rest: string;
}

type Parsed = { kind: 'command'; command: ParsedCommand } | { kind: 'macro'; word: string } | { kind: 'other' };

/** The command word of one line: a `G`/`M` command, a macro (`PRINT_START`), or something else (`T0`). */
function parse(line: string): Parsed {
  // Marlin's line numbers and checksums are not part of the command
  const s = line
    .replace(/^N\d+\s*/i, '')
    .replace(/\*\d+\s*$/, '')
    .trim();
  const word = /^([A-Za-z][A-Za-z0-9_]*)/.exec(s)?.[1] ?? '';
  if (!word) return { kind: 'other' };
  const rest = s.slice(word.length);
  const command = /^([GM])(\d+)$/i.exec(word);
  if (command) return { kind: 'command', command: { letter: command[1].toUpperCase() as 'G' | 'M', number: Number(command[2]), rest } };
  // Marlin accepts blanks between the letter and the number ("M 500"); `M 5000` is still 5000
  const spaced = /^([GM])\s+(\d+)(?![A-Za-z0-9_])/i.exec(s);
  if (spaced)
    return {
      kind: 'command',
      command: { letter: spaced[1].toUpperCase() as 'G' | 'M', number: Number(spaced[2]), rest: s.slice(spaced[0].length) },
    };
  // `T0` is a tool change, not a macro; a single letter is never a Klipper command
  if (word.length < 2 || /^T\d*$/i.test(word)) return { kind: 'other' };
  return { kind: 'macro', word };
}

/** The parameters of a command by upper-case letter, the last occurrence wins (Marlin semantics). */
function paramsOf(rest: string): Map<string, number> {
  const params = new Map<string, number>();
  for (const m of rest.matchAll(PARAM)) params.set(m[1].toUpperCase(), Number(m[2]));
  return params;
}

/** Whether the parameter list of `G0`–`G3` names an axis (the move rules only ask this before homing). */
function hasAxis(rest: string): boolean {
  if (!/[XYZ]/i.test(rest)) return false;
  for (const m of rest.matchAll(PARAM)) {
    const letter = m[1].toUpperCase();
    if (letter === 'X' || letter === 'Y' || letter === 'Z') return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// the rules
// ---------------------------------------------------------------------------

/** The forbidden firmware commands and what they do to the machine. `M211` is checked separately. */
const FORBIDDEN: Readonly<Record<number, string>> = {
  92: 'changes the steps/mm of the axes',
  121: 'switches the endstops off – a crash cannot be stopped any more',
  500: "stores the printer's settings in its EEPROM",
  502: "resets the printer's settings to the firmware defaults",
  851: 'changes the Z offset of the probe',
  997: 'starts a firmware update',
};

/**
 * `M302` (allow cold extrusion). PrusaSlicer's own PrusaResearch presets write `M302 S155` in their
 * start G-code (18 printer sections in 2.9.6), so the command itself cannot block – the vendor sweep
 * would fail on every one of them. Blocking are the forms that make cold extrusion unconditional:
 * `M302` without a temperature limit, `M302 S0`, and `M302 P1`.
 */
const COLD_EXTRUSION = 302;

/** The motor-current commands: a warn, because PrusaSlicer's own presets set the extruder current. */
const MOTOR_CURRENT = new Set([906, 907]);

/** Commands whose `S`/`R` is a hotend target: `M303` (PID autotune), RRF `G10`, RRF `M568`. */
const HOTEND_TARGET = new Set([303]);
/** RRF `G10 S…` / `M568 S… R…` – the same hotend target in RepRapFirmware spelling. */
const RRF_HOTEND = new Set(['G10', 'M568']);
/** The chamber heater commands (`M141` set, `M191` wait). */
const CHAMBER_TEMP = new Set([141, 191]);
/** Klipper's macro spelling of the heater commands. */
const KLIPPER_HEATER = 'SET_HEATER_TEMPERATURE';
/** Klipper's save-the-config command: it rewrites `printer.cfg`. */
const KLIPPER_SAVE = 'SAVE_CONFIG';

/** The `machine_max_*` keys of an `M201`/`M203`/`M205` axis parameter. */
const AXIS_LIMIT: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  201: {
    X: 'machine_max_acceleration_x',
    Y: 'machine_max_acceleration_y',
    Z: 'machine_max_acceleration_z',
    E: 'machine_max_acceleration_e',
  },
  203: { X: 'machine_max_feedrate_x', Y: 'machine_max_feedrate_y', Z: 'machine_max_feedrate_z', E: 'machine_max_feedrate_e' },
  205: { X: 'machine_max_jerk_x', Y: 'machine_max_jerk_y', Z: 'machine_max_jerk_z', E: 'machine_max_jerk_e' },
};

/** The `machine_max_*` keys of an `M204`/`M205` single-letter parameter. */
const SINGLE_LIMIT: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  // P/S: printing acceleration, T: travel, R: retracting
  204: {
    P: 'machine_max_acceleration_extruding',
    S: 'machine_max_acceleration_extruding',
    T: 'machine_max_acceleration_travel',
    R: 'machine_max_acceleration_retracting',
  },
  // J (Marlin) and S (older dialects) are the junction deviation
  205: { J: 'machine_max_junction_deviation', S: 'machine_max_junction_deviation' },
};

/** The first (Normal) value of a `machine_max_*` vector – the second column is the silent mode. */
function normalLimit(config: Readonly<Record<string, string | undefined>>, key: string): number | undefined {
  const raw = config[key];
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  if (!first) return undefined;
  const value = Number(first);
  return Number.isFinite(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// the scanner
// ---------------------------------------------------------------------------

/**
 * The chunked G-code scanner. Feed it the file in text chunks (`push`) and call `finish` once; lines
 * are assembled across chunk boundaries, so a command split over two reads is still found.
 *
 * ```ts
 * const scan = new GcodePreflight({ machineLimits: printerConfig });
 * for await (const chunk of stream) scan.push(chunk);
 * const result = scan.finish();
 * ```
 */
export class GcodePreflight {
  private carry = '';
  /** set while the rest of an overlong line is being skipped */
  private skipping = false;
  private lineNo = 0;
  private readonly issues: PreflightIssue[] = [];
  private readonly counts: Record<string, number> = {};
  private homed = false;
  /** the first macro seen, if any (macro names are not repeated in every message) */
  private macro = '';
  /** no-homing and macro-before-move are stateful: one report is the finding */
  private moveReported = false;
  private readonly hotendLimit: number;
  private readonly bedLimit: number;
  private readonly chamberLimit: number;
  private readonly maxPerRule: number;
  private readonly machineLimits: Readonly<Record<string, string | undefined>>;
  /** the highest temperature the file commands, whatever the ceilings are (N3) */
  private readonly maxTemperatures: MaxTemperatures = { hotend: 0, bed: 0 };

  constructor(options: PreflightOptions = {}) {
    this.machineLimits = options.machineLimits ?? {};
    this.hotendLimit = options.hotendLimit ?? DEFAULT_HOTEND_LIMIT;
    this.bedLimit = options.bedLimit ?? DEFAULT_BED_LIMIT;
    this.chamberLimit = options.chamberLimit ?? DEFAULT_CHAMBER_LIMIT;
    this.maxPerRule = Math.max(1, options.maxIssuesPerRule ?? MAX_ISSUES_PER_RULE);
  }

  /** Scan a chunk of the file; a trailing partial line waits for the next chunk. */
  push(chunk: string): void {
    let text = chunk;
    if (this.skipping) {
      const end = LINE_END.exec(text);
      if (!end) return;
      // a CRLF at the boundary is one line end, not two
      const span = end[0] === '\r' && text[end.index + 1] === '\n' ? 2 : end[0].length;
      text = text.slice(end.index + span);
      this.skipping = false;
    }
    let combined = this.carry + text;
    // A CR at the end of a chunk may be the first half of a CRLF in the next one. It stays in the
    // carry, so the next chunk turns "\r" + "\n" into one line end instead of two (line numbers).
    let hold = false;
    if (combined.endsWith('\r')) {
      hold = true;
      combined = combined.slice(0, -1);
    }
    const lines = combined.split(LINE_END);
    this.carry = (lines.pop() ?? '') + (hold ? '\r' : '');
    for (const line of lines) this.line(line);
    if (this.carry.length > MAX_LINE_LENGTH) {
      // no command is that long: drop it rather than buffering the rest of a broken file
      this.carry = '';
      this.skipping = true;
    }
  }

  /** The scan of everything pushed so far; a last line without a newline is included. */
  finish(): PreflightResult {
    if (this.carry) {
      const last = this.carry;
      this.carry = '';
      this.line(last);
    }
    return { version: PREFLIGHT_VERSION, issues: this.issues, counts: { ...this.counts }, maxTemperatures: { ...this.maxTemperatures } };
  }

  /** Record one finding, capped per rule. */
  private report(rule: string, line: number, text: string, message: string): void {
    this.counts[rule] = (this.counts[rule] ?? 0) + 1;
    if ((this.counts[rule] as number) > this.maxPerRule) return;
    this.issues.push({ rule, severity: PREFLIGHT_SEVERITY[rule] ?? 'warn', message: `Line ${line}: ${message}`, line, text });
  }

  private line(raw: string): void {
    this.lineNo++;
    const text = raw.replace(/\r$/, '').trim();
    const code = stripComments(text).trim();
    if (!code) return;
    const parsed = parse(code);
    if (parsed.kind === 'macro') {
      if (!this.macro) this.macro = parsed.word;
      if (parsed.word.toUpperCase() === KLIPPER_SAVE) {
        this.report(
          'gcode.forbidden_command',
          this.lineNo,
          text,
          '"SAVE_CONFIG" rewrites the printer configuration (Klipper) – a forbidden command.',
        );
      } else if (parsed.word.toUpperCase() === KLIPPER_HEATER) this.klipperHeater(text);
      return;
    }
    if (parsed.kind !== 'command') return;
    const { letter, number, rest } = parsed.command;
    if (letter === 'G') this.gcode(number, rest, text);
    else this.mcode(number, rest, text);
  }

  private gcode(number: number, rest: string, text: string): void {
    if (number === 28) {
      this.homed = true;
      return;
    }
    // RRF: G10 sets a tool/hotend temperature, M568 the active/standby one – both `S` is a target
    if (RRF_HOTEND.has(`G${number}`)) {
      this.hotendTargets(paramsOf(rest), text, `G${number}`);
      return;
    }
    // a move with an axis coordinate; a feedrate-only line (G1 F720) moves nothing
    if (number !== 0 && number !== 1 && number !== 2 && number !== 3) return;
    if (!hasAxis(rest)) return;
    if (this.homed || this.moveReported) return;
    this.moveReported = true;
    if (this.macro) {
      this.report(
        'gcode.macro_before_move',
        this.lineNo,
        text,
        `the axes are moved before any G28. The macro "${this.macro}" may home them – WebSlicer cannot verify that.`,
      );
      return;
    }
    this.report(
      'gcode.no_homing',
      this.lineNo,
      text,
      'the axes are moved before any G28 – the printer has not homed, so the move can hit the frame.',
    );
  }

  private mcode(number: number, rest: string, text: string): void {
    // the parameters are only parsed for the commands that read them (an M-code is rare in a file)
    if (MOTOR_CURRENT.has(number)) {
      this.report(
        'gcode.motor_current',
        this.lineNo,
        text,
        `"M${number}" changes the motor current. PrusaSlicer sets the extruder current in the presets' own start/end G-code; any other value can damage the printer.`,
      );
      return;
    }
    // RRF M568 sets the active/standby hotend temperature – `S` and `R` are targets
    if (RRF_HOTEND.has(`M${number}`)) {
      this.hotendTargets(paramsOf(rest), text, `M${number}`);
      return;
    }
    const why = FORBIDDEN[number];
    if (why) {
      this.report('gcode.forbidden_command', this.lineNo, text, `"M${number}" ${why} – a forbidden command.`);
      return;
    }
    // M302 blocks only in its unconditional forms; `M302 S155` is in PrusaSlicer's own presets
    if (number === COLD_EXTRUSION) {
      const params = paramsOf(rest);
      const s = params.get('S');
      const p = params.get('P');
      if (s === undefined || s === 0 || p === 1) {
        this.report(
          'gcode.forbidden_command',
          this.lineNo,
          text,
          '"M302" allows cold extrusion without a temperature limit – the filament is pushed while the nozzle is cold.',
        );
      }
      return;
    }
    if (
      number !== 211 &&
      number !== 104 &&
      number !== 109 &&
      number !== 140 &&
      number !== 190 &&
      !CHAMBER_TEMP.has(number) &&
      !HOTEND_TARGET.has(number) &&
      !AXIS_LIMIT[number] &&
      !SINGLE_LIMIT[number]
    )
      return;
    const params = paramsOf(rest);
    if (number === 211) {
      if (params.get('S') === 0) {
        this.report('gcode.forbidden_command', this.lineNo, text, '"M211 S0" disables the software endstops – a forbidden command.');
      }
      return;
    }
    if (number === 104 || number === 109) {
      for (const key of ['S', 'R']) this.temperature(key, params.get(key), this.hotendLimit, 'hotend', text);
      return;
    }
    if (number === 140 || number === 190) {
      for (const key of ['S', 'R']) this.temperature(key, params.get(key), this.bedLimit, 'bed', text);
      return;
    }
    if (CHAMBER_TEMP.has(number)) {
      for (const key of ['S', 'R']) this.temperature(key, params.get(key), this.chamberLimit, 'chamber', text);
      return;
    }
    // M303's PID target is the hotend; `S` is the only target parameter there
    if (HOTEND_TARGET.has(number)) {
      this.hotendTargets(params, text, `M${number}`);
      return;
    }
    const axes = AXIS_LIMIT[number];
    if (axes) {
      for (const [axis, key] of Object.entries(axes)) this.limit(axis, params.get(axis), key, number, text);
    }
    const singles = SINGLE_LIMIT[number];
    if (singles) {
      for (const [param, key] of Object.entries(singles)) this.limit(param, params.get(param), key, number, text);
    }
  }

  private temperature(
    param: string,
    value: number | undefined,
    limit: number,
    what: 'hotend' | 'bed' | 'chamber',
    text: string,
    command?: string,
  ): void {
    if (value === undefined) return;
    // the maximum is recorded whatever the ceilings are: the send gate compares it with the target
    // printer's own limits, which the stored scan knows nothing about (N3). The chamber has no
    // printer limit, so it is only checked against the global catcher.
    if (what !== 'chamber') this.maxTemperatures[what] = Math.max(this.maxTemperatures[what], value);
    if (value <= limit) return;
    const name = command ? `"${command} ${param}${value}"` : `${param}${value}`;
    this.report('gcode.max_temp', this.lineNo, text, `${name} sets the ${what} to ${value} °C, above the ${limit} °C limit.`);
  }

  private limit(param: string, value: number | undefined, key: string, command: number, text: string): void {
    if (value === undefined) return;
    const max = normalLimit(this.machineLimits, key);
    if (max === undefined || value <= max) return;
    this.report('gcode.firmware_limit', this.lineNo, text, `"M${command} ${param}${value}" is above the printer preset's ${key} = ${max}.`);
  }

  /** The hotend targets of `M303`, RRF `G10`/`M568`: `S` is the target, `R` the wait-for value. */
  private hotendTargets(params: ReadonlyMap<string, number>, text: string, command: string): void {
    for (const key of ['S', 'R']) this.temperature(key, params.get(key), this.hotendLimit, 'hotend', text, command);
  }

  /**
   * Klipper's `SET_HEATER_TEMPERATURE HEATER=extruder TARGET=260`: the heater names the kind, the
   * target is the temperature. An unknown heater is checked as a hotend (the common case).
   */
  private klipperHeater(text: string): void {
    const heater = /HEATER\s*=\s*(\S+)/i.exec(text)?.[1]?.toLowerCase() ?? '';
    const target = Number(/TARGET\s*=\s*(-?\d+(?:\.\d+)?)/i.exec(text)?.[1]);
    if (!Number.isFinite(target)) return;
    const what = heater.includes('bed') ? 'bed' : heater.includes('chamber') ? 'chamber' : 'hotend';
    const limit = what === 'bed' ? this.bedLimit : what === 'chamber' ? this.chamberLimit : this.hotendLimit;
    this.temperature('TARGET', target, limit, what, text, 'SET_HEATER_TEMPERATURE');
  }
}

/**
 * Scan a whole G-code text. For files use the chunked `GcodePreflight` – a real G-code is tens of MB
 * and must not become one string.
 */
export function scanGcodeText(text: string, options: PreflightOptions = {}): PreflightResult {
  const scan = new GcodePreflight(options);
  scan.push(text);
  return scan.finish();
}

// ---------------------------------------------------------------------------
// the settings side: the custom G-code of the request
// ---------------------------------------------------------------------------

/**
 * The preset keys that carry G-code PrusaSlicer inserts verbatim into the output – the merged config
 * is scanned for them before a job is queued (T-080, P-1). The plater's custom G-code entries are
 * scanned the same way.
 */
export const CONFIG_GCODE_KEYS = [
  'start_gcode',
  'end_gcode',
  'layer_gcode',
  'before_layer_gcode',
  'toolchange_gcode',
  'color_change_gcode',
  'pause_print_gcode',
  'template_custom_gcode',
  'between_objects_gcode',
] as const;

/** One block of custom G-code and the name it is reported under. */
export interface ConfigGcodeEntry {
  /** `start_gcode`, or `custom G-code at 5 mm` for a plater entry */
  label: string;
  text: string;
}

/** The custom G-code of a request: the merged config's keys plus the plater's entries, unescaped. */
export function configGcodeEntries(
  config: Readonly<Record<string, string | undefined>>,
  customGcodes: ReadonlyArray<{ printZ?: number; extra?: string }> = [],
): ConfigGcodeEntry[] {
  const entries: ConfigGcodeEntry[] = [];
  for (const key of CONFIG_GCODE_KEYS) {
    const raw = config[key];
    if (raw) entries.push({ label: key, text: unescapeStringCstyle(raw) });
  }
  for (const entry of customGcodes) {
    if (entry.extra) entries.push({ label: `custom G-code at ${entry.printZ ?? 0} mm`, text: unescapeStringCstyle(entry.extra) });
  }
  return entries;
}

/**
 * The blocking findings of the request's own custom G-code, with the setting named in the message.
 *
 * This closes the hole a binary output leaves (T-080, P-1): the preflight never reads a `.bgcode`
 * body, so a forbidden command in a preset's start/end G-code would reach the printer behind one
 * "not scanned" warning. The settings that produce the file are known before the slicer runs, and
 * the same scanner reads them – one rule set, no second copy.
 *
 * Only the **blocking** rules are reported here: the file scan of an ASCII output already finds the
 * same commands (the send gate drops the duplicate), and its warnings stay its own. The ordering
 * rules (`no_homing`, `macro_before_move`) apply to the start G-code only – an end G-code follows a
 * file that homed long before, and a mid-print entry runs after the start G-code.
 */
export function scanConfigGcode(
  config: Readonly<Record<string, string | undefined>>,
  customGcodes: ReadonlyArray<{ printZ?: number; extra?: string }> = [],
  options: PreflightOptions = {},
): ConfigPreflightScan {
  const issues: PreflightIssue[] = [];
  const counts: Record<string, number> = {};
  const max = Math.max(1, options.maxIssuesPerRule ?? MAX_ISSUES_PER_RULE);
  for (const entry of configGcodeEntries(config, customGcodes)) {
    const scan = new GcodePreflight(options);
    scan.push(entry.text);
    for (const issue of scan.finish().issues) {
      if (issue.severity !== 'block') continue;
      // the ordering rules describe a print start; an end or mid-print block runs later
      if (entry.label !== 'start_gcode' && (issue.rule === 'gcode.no_homing' || issue.rule === 'gcode.macro_before_move')) continue;
      counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
      if (counts[issue.rule] > max) continue;
      // the scanner's message starts with the line inside *its* text; for a setting the setting and
      // the line inside it are the reference, and `line: 0` keeps a dialog from naming a file line
      // that cannot be looked at (a `.bgcode` has no readable body)
      issues.push({ ...issue, line: 0, message: `${entry.label} line ${issue.line}: ${issue.message.replace(/^Line \d+: /, '')}` });
    }
  }
  return { version: PREFLIGHT_VERSION, issues, counts };
}

/** The config findings of a stored preflight result, if it was made with the current rule set. */
export function configPreflightIssues(result: PreflightResult | undefined): PreflightIssue[] {
  return currentPreflight(result)?.config?.issues ?? [];
}

/**
 * The config findings that add to what the file scan found. A finding the file scan already reports
 * (same rule, same G-code line) is one command, not a second problem, so it is dropped; with an
 * unread body (binary G-code) nothing is dropped.
 */
export function configIssuesBeyond(result: PreflightResult | undefined, fileIssues: readonly PreflightIssue[]): PreflightIssue[] {
  const seen = new Set(fileIssues.map((issue) => `${issue.rule}\u0000${issue.text}`));
  return configPreflightIssues(result).filter((issue) => !seen.has(`${issue.rule}\u0000${issue.text}`));
}

/** What the preview and the send gate list: the file findings and the config findings they miss. */
export function combinedPreflight(result: PreflightResult | undefined): { issues: PreflightIssue[]; counts: Record<string, number> } {
  const current = currentPreflight(result);
  if (!current) return { issues: [], counts: {} };
  const extra = configIssuesBeyond(current, current.issues);
  const counts = { ...current.counts };
  for (const issue of extra) counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
  return { issues: [...current.issues, ...extra], counts };
}

/**
 * The issues of a stored result as the send gate and the dialog show them: the file scan plus the
 * config findings it does not already cover.
 */
export function storedPreflightIssues(result: PreflightResult | undefined): SendIssue[] {
  return combinedPreflight(result).issues;
}

/** The stored preflight of a job, if it was made with the current rule set. */
export function currentPreflight(result: PreflightResult | undefined): PreflightResult | undefined {
  return result && result.version === PREFLIGHT_VERSION ? result : undefined;
}

/**
 * The stored result the **send gate** may trust: current rule set *and* the temperature maxima of N3.
 * A record without them (an older version, or one written before the field existed) is re-scanned.
 */
export function usablePreflight(result: PreflightResult | undefined): PreflightResult | undefined {
  const current = currentPreflight(result);
  return current?.maxTemperatures ? current : undefined;
}

/** The issues of a stored result as send-gate issues (a `PreflightIssue` is a `SendIssue`). */
export function preflightSendIssues(result: PreflightResult | undefined): SendIssue[] {
  return currentPreflight(result)?.issues ?? [];
}

/** Blocking issues and warnings of a stored result, the capped ones and the config findings included. */
export function preflightSummary(result: PreflightResult | undefined): PreflightSummary {
  const summary: PreflightSummary = { blocking: 0, warnings: 0 };
  for (const [rule, count] of Object.entries(combinedPreflight(result).counts)) {
    if (PREFLIGHT_SEVERITY[rule] === 'block') summary.blocking += count;
    else summary.warnings += count;
  }
  return summary;
}

/** The warn issue of an output that v1 does not read (binary G-code, or no file at all). */
export function notScannedIssue(reason: string): SendIssue {
  return {
    rule: 'gcode.not_scanned',
    severity: 'warn',
    message: `WebSlicer did not scan this file before sending: ${reason}.`,
  };
}
