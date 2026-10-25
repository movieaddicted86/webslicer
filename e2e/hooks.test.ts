/**
 * The guard for the stable test hooks.
 *
 * The layout tasks move the sidebar, the tool bar and the top bar between regions. A spec that
 * selects a region by its structural class (`.sidebar`, `.tool-panel`, …) breaks on every move, so
 * the specs select by `data-testid` instead (see `e2e/helpers/hooks.ts`). This file fails the unit
 * tests when a spec reaches for a legacy class selector again, and pins that the hooks the specs use
 * still exist on the components.
 *
 * A selector may keep naming a class when the class is the *subject* of the assertion and not a
 * handle on a region. The allow-list says which and why, and every entry has to still occur, so it
 * cannot rot.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(import.meta.dirname, '..');
const SPECS = path.join(import.meta.dirname, 'specs');
const WEB_SRC = path.join(ROOT, 'web', 'src');

/** The structural class selectors a layout move invalidates. */
const LEGACY = [
  '.sidebar',
  '.tool-bar',
  '.tool-panel',
  '.object-row',
  '.slice-panel',
  '.quick-settings',
  '.presets',
  '.objects',
  '.modal',
] as const;

type Legacy = (typeof LEGACY)[number];

/** Selectors a spec may keep although they name a legacy class, with the reason. */
const ALLOWED: ReadonlyArray<{ file: string; selector: Legacy; reason: string }> = [
  {
    file: 'sidebar.spec.ts',
    selector: '.slice-panel',
    reason: 'the DOM outline prints class names; the assertion reads that diagnostic text, it never locates by it',
  },
];

interface Hit {
  line: number;
  selector: Legacy;
}

/**
 * The string literals of a source with the line each starts on. Comments are skipped, so a comment
 * that names a selector (such as the reason for a rule) is not an offence.
 */
function literals(source: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
    } else if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
    } else if (c === "'" || c === '"' || c === '`') {
      const start = line;
      let text = '';
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '\n') {
          line++;
          // a plain string cannot span a line: that quote was not the start of a string
          if (c !== '`') break;
        }
        text += source[i++];
      }
      i++;
      out.push({ line: start, text });
    } else {
      i++;
    }
  }
  return out;
}

/** The legacy selectors inside the literals of one source. */
function selectorHits(source: string): Hit[] {
  const hits: Hit[] = [];
  for (const literal of literals(source)) {
    for (const selector of LEGACY) {
      for (let at = literal.text.indexOf(selector); at >= 0; at = literal.text.indexOf(selector, at + 1)) {
        const before = at > 0 ? literal.text[at - 1] : '';
        const after = literal.text[at + selector.length] ?? '';
        // `s.objects` reads a property and `.tool-bar-group` is another class; neither is the selector
        if (/[\w$)\]]/.test(before) || /[\w-]/.test(after)) continue;
        hits.push({ line: literal.line, selector });
      }
    }
  }
  return hits;
}

const specFiles = (): string[] =>
  readdirSync(SPECS)
    .filter((f) => f.endsWith('.ts'))
    .sort();

const specSource = (file: string): string => readFileSync(path.join(SPECS, file), 'utf8');

test('no E2E spec selects a layout element by a legacy structural class', () => {
  const offenders: string[] = [];
  for (const file of specFiles()) {
    for (const hit of selectorHits(specSource(file))) {
      if (ALLOWED.some((a) => a.file === file && a.selector === hit.selector)) continue;
      offenders.push(`${file}:${hit.line}: ${hit.selector} → select the hook instead (e2e/helpers/hooks.ts)`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('every allowed legacy selector still occurs, so the allow-list cannot rot', () => {
  for (const entry of ALLOWED) {
    assert.ok(
      selectorHits(specSource(entry.file)).some((h) => h.selector === entry.selector),
      `${entry.file} no longer uses ${entry.selector} – drop it from the allow-list (${entry.reason})`,
    );
  }
});

/** The structural hooks the layout tasks key on. */
const HOOKS = [
  'app-shell',
  'top-bar',
  'rail',
  'rail-slicing',
  'rail-library',
  'rail-printers',
  'rail-preferences',
  'rail-about',
  'menu',
  'menu-panel',
  'menu-settings',
  'menu-export',
  'preferences-reset-layout',
  'hide-panels',
  'left-column',
  'left-column-toggle',
  'left-sliced-toggle',
  'left-legend-toggle',
  'objects-drawer-toggle',
  'context-panel',
  'context-header',
  'context-footer',
  'object-transform',
  'object-actions',
  'object-header',
  'object-header-meta',
  'object-rename',
  'object-mirror-X',
  'object-mirror-Y',
  'object-mirror-Z',
  'object-reset-rotation',
  'object-reset-scale',
  'object-reset-all',
  'object-lock-proportions',
  'object-split-objects',
  'object-split-parts',
  'object-add-instance',
  'object-settings-card',
  'object-settings',
  'parts-card',
  'object-add-volume',
  'volume-list',
  'range-card',
  'range-list',
  'range-add',
  'destination',
  'multi-selection',
  'presets',
  'preset-select',
  'object-list',
  'object-toolbar',
  'object-row',
  'object-info',
  'add-objects',
  'quick-settings',
  'all-settings',
  'quick-density',
  'quick-pattern',
  'quick-supports',
  'quick-brim',
  'slice-panel',
  'slice-button',
  'tool-bar',
  'tool-strip',
  'tool-overflow',
  'view-switch',
  'view-plater',
  'view-preview',
  'tool-panel',
  'tool-panel-title',
  'tool-panel-foot',
  'tool-hints',
  'modal',
  'modal-title',
  'modal-actions',
  'modal-primary',
  'preview-panel',
  'preview-blockers',
  'preview-slice-button',
  'preview-view-card',
  'preview-check-card',
  'preview-layer-card',
  'preview-view-mode',
  'preview-show-travel',
  'preview-show-shells',
  'preview-actions',
  'export-gcode',
  'save-gcode',
  'layer-summary',
  'sliced-badge',
  'layer-slider',
  'move-slider',
  'legend',
  'sliced-info',
  'send-button',
  'toast',
] as const;

/**
 * Every `.tsx` of the web app, keyed by its path below `web/src` (slashes) – plus the navigation map,
 * which is a `.ts` table: the rail's per-entry hooks are its `testId` fields, and the rail renders
 * them (`data-testid={entry.testId}`), so no component spells them out.
 */
function components(dir = WEB_SRC, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) for (const [k, v] of components(path.join(dir, entry.name), rel)) out.set(k, v);
    else if (entry.name.endsWith('.tsx') || (prefix === 'nav' && entry.name === 'navMap.ts')) {
      out.set(rel, readFileSync(path.join(dir, entry.name), 'utf8'));
    }
  }
  return out;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('every structural hook is a data-testid on a component', () => {
  const sources = [...components().values()];
  const missing = HOOKS.filter((hook) => {
    // a fixed hook (`data-testid="modal"`), a template hook (`preset-select-${type}`) and a table
    // field (`testId: 'rail-slicing'`) all count, and so does a card that forwards a `testId` prop
    const pattern = new RegExp(`(?:data-testid|testId|toggleTestId)\\s*[:=]\\s*\\{?["'\`]${escape(hook)}`);
    return !sources.some((src) => pattern.test(src));
  });
  assert.deepEqual(missing, [], 'hook missing on the components, or renamed – update the spec and this list');
});

test('the tool strip derives its per-tool hooks from the registry and the shared button forwards them', () => {
  const src = components();
  assert.match(src.get('components/tools/ToolStrip.tsx') ?? '', /testId=\{`tool-\$\{tool\.id\}`\}/);
  assert.match(src.get('components/common/ToolbarButton.tsx') ?? '', /data-testid=\{testId\}/);
});

test('Playwright is told which attribute the hooks live in, and the helper reads it', () => {
  const config = readFileSync(path.join(ROOT, 'playwright.config.ts'), 'utf8');
  assert.match(config, /testIdAttribute:\s*'data-testid'/);
  const helper = readFileSync(path.join(import.meta.dirname, 'helpers', 'hooks.ts'), 'utf8');
  assert.match(helper, /export function byId\(/);
  assert.match(helper, /getByTestId\(/);
});
