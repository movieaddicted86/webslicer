/**
 * Evaluator for PrusaSlicer compatibility conditions
 * (compatible_printers_condition / compatible_prints_condition).
 *
 * Supports the subset of the PlaceholderParser expression language used in
 * vendor bundles: and/or/not, comparisons, regex match (=~, !~), arithmetic,
 * indexing of vector options and a few builtin functions.
 */
import { splitVector, unescapeStringsCstyle } from '@webslicer/shared';

type Value = number | string | boolean;

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'regex'; v: RegExp }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' };

export type ConfigLookup = (key: string) => string | undefined;

/**
 * PrusaSlicer evaluates "=~" with boost::regex_match, i.e. the whole string has to match.
 * JavaScript's test() searches for a substring, so the pattern is anchored here.
 */
function fullMatchRegex(pattern: string, ignoreCase: boolean): RegExp {
  try {
    return new RegExp(`^(?:${pattern})$`, ignoreCase ? 'is' : 's');
  } catch {
    return /(?!)/;
  }
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const ops = [
    '==',
    '!=',
    '<>',
    '<=',
    '>=',
    '=~',
    '!~',
    '&&',
    '||',
    '<',
    '>',
    '+',
    '-',
    '*',
    '/',
    '%',
    '(',
    ')',
    '[',
    ']',
    '!',
    ',',
    '?',
    ':',
  ];
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?|^[0-9]+/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      tokens.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      tokens.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    if (c === '/') {
      // regex literal when preceded by =~ or !~
      const prev = tokens[tokens.length - 1];
      if (prev && prev.t === 'op' && (prev.v === '=~' || prev.v === '!~')) {
        let j = i + 1;
        let s = '';
        while (j < src.length && src[j] !== '/') {
          if (src[j] === '\\' && src[j + 1] === '/') {
            s += '/';
            j += 2;
          } else s += src[j++];
        }
        i = j + 1;
        let flags = '';
        // only the case-insensitive flag is meaningful; anything else belongs to the next token (e.g. "/re/and ...")
        while (i < src.length && src[i] === 'i' && !/[A-Za-z0-9_]/.test(src[i + 1] || '')) flags += src[i++];
        tokens.push({ t: 'regex', v: fullMatchRegex(s, flags.includes('i')) });
        continue;
      }
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = ops.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at ${i}`);
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private lookup: ConfigLookup,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    return this.tokens[this.pos++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }
  private isId(v: string): boolean {
    const t = this.peek();
    return t.t === 'id' && t.v === v;
  }

  parse(): Value {
    const v = this.ternary();
    if (this.peek().t !== 'eof') throw new Error('Unexpected trailing tokens');
    return v;
  }

  private ternary(): Value {
    const c = this.or();
    if (this.isOp('?')) {
      this.next();
      const a = this.ternary();
      if (!this.isOp(':')) throw new Error("Expected ':'");
      this.next();
      const b = this.ternary();
      return truthy(c) ? a : b;
    }
    return c;
  }

  private or(): Value {
    let left = this.and();
    while (this.isOp('||') || this.isId('or')) {
      this.next();
      const right = this.and();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  private and(): Value {
    let left = this.not();
    while (this.isOp('&&') || this.isId('and')) {
      this.next();
      const right = this.not();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  private not(): Value {
    if (this.isOp('!') || this.isId('not')) {
      this.next();
      return !truthy(this.not());
    }
    return this.comparison();
  }

  private comparison(): Value {
    let left = this.additive();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op') return left;
      switch (t.v) {
        case '==':
        case '!=':
        case '<>':
        case '<':
        case '>':
        case '<=':
        case '>=': {
          this.next();
          const right = this.additive();
          left = compare(t.v, left, right);
          break;
        }
        case '=~':
        case '!~': {
          this.next();
          const r = this.next();
          let re: RegExp;
          if (r.t === 'regex') re = r.v;
          else if (r.t === 'str') re = fullMatchRegex(r.v, false);
          else throw new Error('Expected regex');
          const m = re.test(String(left));
          left = t.v === '=~' ? m : !m;
          break;
        }
        default:
          return left;
      }
    }
  }

  private additive(): Value {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v;
      const right = this.multiplicative();
      left = op === '+' ? num(left) + num(right) : num(left) - num(right);
    }
    return left;
  }

  private multiplicative(): Value {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = (this.next() as { v: string }).v;
      const right = this.unary();
      if (op === '*') left = num(left) * num(right);
      else if (op === '/') left = num(left) / num(right);
      else left = num(left) % num(right);
    }
    return left;
  }

  private unary(): Value {
    if (this.isOp('-')) {
      this.next();
      return -num(this.unary());
    }
    if (this.isOp('+')) {
      this.next();
      return num(this.unary());
    }
    return this.primary();
  }

  private primary(): Value {
    const t = this.next();
    if (t.t === 'num') return t.v;
    if (t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') {
      const v = this.ternary();
      if (!this.isOp(')')) throw new Error("Expected ')'");
      this.next();
      return v;
    }
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      // function call
      if (this.isOp('(')) {
        this.next();
        const args: Value[] = [];
        if (!this.isOp(')')) {
          args.push(this.ternary());
          while (this.isOp(',')) {
            this.next();
            args.push(this.ternary());
          }
        }
        if (!this.isOp(')')) throw new Error("Expected ')'");
        this.next();
        return callFn(t.v, args);
      }
      let value = this.variable(t.v);
      if (this.isOp('[')) {
        this.next();
        const idx = Math.floor(num(this.ternary()));
        if (!this.isOp(']')) throw new Error("Expected ']'");
        this.next();
        const raw = this.lookup(t.v) ?? '';
        value = indexVector(raw, idx);
      }
      return value;
    }
    throw new Error('Unexpected token');
  }

  private variable(name: string): Value {
    if (name === 'num_extruders') {
      const nd = this.lookup('nozzle_diameter');
      return nd ? splitVector(nd).length : 1;
    }
    const raw = this.lookup(name);
    if (raw === undefined) return '';
    // scalar numbers
    if (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(raw.trim())) return Number(raw);
    // vectors: use first element for comparisons
    if (raw.includes(',') && /^[-\d.,e%\s]+$/i.test(raw)) return indexVector(raw, 0);
    return raw;
  }
}

function indexVector(raw: string, idx: number): Value {
  let parts: string[];
  if (raw.includes('"') || (raw.includes(';') && !/^[-\d.,e%\s]+$/i.test(raw))) parts = unescapeStringsCstyle(raw);
  else parts = splitVector(raw);
  const v = parts[Math.min(idx, parts.length - 1)] ?? '';
  if (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(v.trim())) return Number(v);
  if (v === 'nil') return 0;
  return v;
}

function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return v !== '' && v !== '0';
}

function num(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

function compare(op: string, a: Value, b: Value): boolean {
  const numeric = (typeof a === 'number' || typeof a === 'boolean') && (typeof b === 'number' || typeof b === 'boolean');
  const bothNumericStrings = !numeric && /^-?\d+(\.\d+)?$/.test(String(a).trim()) && /^-?\d+(\.\d+)?$/.test(String(b).trim());
  if (numeric || bothNumericStrings) {
    const x = num(a);
    const y = num(b);
    switch (op) {
      case '==':
        return Math.abs(x - y) < 1e-9;
      case '!=':
      case '<>':
        return Math.abs(x - y) >= 1e-9;
      case '<':
        return x < y;
      case '>':
        return x > y;
      case '<=':
        return x <= y;
      case '>=':
        return x >= y;
    }
  }
  const x = String(a);
  const y = String(b);
  switch (op) {
    case '==':
      return x === y;
    case '!=':
    case '<>':
      return x !== y;
    case '<':
      return x < y;
    case '>':
      return x > y;
    case '<=':
      return x <= y;
    case '>=':
      return x >= y;
  }
  return false;
}

function callFn(name: string, args: Value[]): Value {
  switch (name) {
    case 'min':
      return Math.min(...args.map(num));
    case 'max':
      return Math.max(...args.map(num));
    case 'int':
      return Math.trunc(num(args[0]));
    case 'round':
      return Math.round(num(args[0]));
    case 'abs':
      return Math.abs(num(args[0]));
    case 'is_nil':
      return args[0] === 'nil' || args[0] === '';
    case 'one_of': {
      const [v, ...rest] = args;
      return rest.some((r) => String(r) === String(v));
    }
    default:
      throw new Error(`Unknown function ${name}`);
  }
}

/**
 * Evaluate a condition. Returns true when the condition is empty, and
 * `fallback` when the expression cannot be parsed.
 */
export function evaluateCondition(expr: string | undefined, lookup: ConfigLookup, fallback = true): boolean {
  if (!expr || !expr.trim()) return true;
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens, lookup);
    return truthy(parser.parse());
  } catch {
    return fallback;
  }
}
