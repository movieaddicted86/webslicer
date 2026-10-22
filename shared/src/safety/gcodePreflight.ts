/**
 * G-code preflight v1 (S1-c, T-031): what does a finished print file do before it is sent?
 *
 * Custom start/end/layer G-code and firmware commands go 1:1 into the output – that is the point of a
 * custom G-code – but a preset or an MCP-written setting can therefore ship commands that rewrite the
 * printer's EEPROM, disable the endstops, change steps/mm or currents, flash firmware, or heat beyond
 * any sane value. Nothing looked at the produced file before the send dialog; this scanner does.
 *
 * The rule set of Q-005, deliberately small and free of position tracking (purge lines, delta beds and
 * relative moves would make bounds checks noisy – PrusaSlicer already checks the object bounds):
 *
 * | rule                     | severity | finding                                                        |
 * | ------------------------ | -------- | -------------------------------------------------------------- |
 * | `gcode.forbidden_command`| block    | `M500 M502 M211 S0 M92 M997 M851`                                |
 * | `gcode.motor_current`    | warn     | `M906`/`M907` – see below                                       |
 * | `gcode.max_temp`         | block    | `M104`/`M109` above 450 °C, `M140`/`M190` above 150 °C            |
 * | `gcode.no_homing`        | block    | a move with X/Y/Z before the first `G28`                         |
 * | `gcode.macro_before_move`| warn     | the same, but a printer macro (e.g. `PRINT_START`) came first    |
 * | `gcode.firmware_limit`   | warn     | `M201 M203 M204 M205` above the printer preset's `machine_max_*` |
 * | `gcode.not_scanned`      | warn     | the output is binary G-code, which v1 does not read              |
 *
 * **`M906`/`M907` are a warning, not a block** (deviation from the task, see the T-031 report):
 * PrusaSlicer's own printer presets set the extruder current in their start and end G-code – the stock
 * MK3S preset writes `M907 E430` in `start_gcode` and `M907 E538` in `end_gcode`, so a block would
 * refuse every file the slicer produces for that printer. Prusa's own comment there ("Excessive value
 * can damage the printer") is the reason the command is reported at all: it shows in the dialog with
 * its line, and starting a print right away needs a confirmation.
 *
 * The temperature ceilings and the machine limits are inputs, not constants: S1-d passes the
 * per-printer limits in. The scan is a stateful chunked scanner (files are tens of MB – never a
 * whole-file string), and the result is stored on the job with `PREFLIGHT_VERSION`, so a later rule
 * set can re-run it.
 *
 * The issues have the shape of a `SendIssue` plus the line number and the offending line, so the send
 * gate can merge them with its preset issues without a second format.
 */
import type { PreflightIssue, PreflightResult, SendIssue, SendIssueSeverity } from '../types/jobs.js';

/** Version of the rule set; a stored result of another version is re-scanned. */
export const PREFLIGHT_VERSION = 1;

/** Wide typo catchers of Q-005 – narrow per-printer limits are S1-d. */
export const DEFAULT_HOTEND_LIMIT = 450;
export const DEFAULT_BED_LIMIT = 150;
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
  500: "stores the printer's settings in its EEPROM",
  502: "resets the printer's settings to the firmware defaults",
  851: 'changes the Z offset of the probe',
  997: 'starts a firmware update',
};

/** The motor-current commands: a warn, because PrusaSlicer's own presets set the extruder current. */
const MOTOR_CURRENT = new Set([906, 907]);

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
  private readonly maxPerRule: number;
  private readonly machineLimits: Readonly<Record<string, string | undefined>>;

  constructor(options: PreflightOptions = {}) {
    this.machineLimits = options.machineLimits ?? {};
    this.hotendLimit = options.hotendLimit ?? DEFAULT_HOTEND_LIMIT;
    this.bedLimit = options.bedLimit ?? DEFAULT_BED_LIMIT;
    this.maxPerRule = Math.max(1, options.maxIssuesPerRule ?? MAX_ISSUES_PER_RULE);
  }

  /** Scan a chunk of the file; a trailing partial line waits for the next chunk. */
  push(chunk: string): void {
    let text = chunk;
    if (this.skipping) {
      const end = text.indexOf('\n');
      if (end < 0) return;
      text = text.slice(end + 1);
      this.skipping = false;
    }
    const lines = (this.carry + text).split('\n');
    this.carry = lines.pop() ?? '';
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
    return { version: PREFLIGHT_VERSION, issues: this.issues, counts: { ...this.counts } };
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
    const why = FORBIDDEN[number];
    if (why) {
      this.report('gcode.forbidden_command', this.lineNo, text, `"M${number}" ${why} – a forbidden command.`);
      return;
    }
    if (
      number !== 211 &&
      number !== 104 &&
      number !== 109 &&
      number !== 140 &&
      number !== 190 &&
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
    const axes = AXIS_LIMIT[number];
    if (axes) {
      for (const [axis, key] of Object.entries(axes)) this.limit(axis, params.get(axis), key, number, text);
    }
    const singles = SINGLE_LIMIT[number];
    if (singles) {
      for (const [param, key] of Object.entries(singles)) this.limit(param, params.get(param), key, number, text);
    }
  }

  private temperature(param: string, value: number | undefined, limit: number, what: string, text: string): void {
    if (value === undefined || value <= limit) return;
    this.report('gcode.max_temp', this.lineNo, text, `${param}${value} sets the ${what} to ${value} °C, above the ${limit} °C limit.`);
  }

  private limit(param: string, value: number | undefined, key: string, command: number, text: string): void {
    if (value === undefined) return;
    const max = normalLimit(this.machineLimits, key);
    if (max === undefined || value <= max) return;
    this.report('gcode.firmware_limit', this.lineNo, text, `"M${command} ${param}${value}" is above the printer preset's ${key} = ${max}.`);
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

/** The stored preflight of a job, if it was made with the current rule set. */
export function currentPreflight(result: PreflightResult | undefined): PreflightResult | undefined {
  return result && result.version === PREFLIGHT_VERSION ? result : undefined;
}

/** The issues of a stored result as send-gate issues (a `PreflightIssue` is a `SendIssue`). */
export function preflightSendIssues(result: PreflightResult | undefined): SendIssue[] {
  return currentPreflight(result)?.issues ?? [];
}

/** Blocking issues and warnings of a stored result, the capped ones included. */
export function preflightSummary(result: PreflightResult | undefined): PreflightSummary {
  const summary: PreflightSummary = { blocking: 0, warnings: 0 };
  for (const [rule, count] of Object.entries(currentPreflight(result)?.counts ?? {})) {
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
