/**
 * `node scripts/vendor-icons.mjs` – copy the PrusaSlicer icons WebSlicer uses into the repository.
 *
 * PrusaSlicer 3.0 ships its icons in `resources/icons/` of the AGPL-3.0 repository. A developer runs
 * this script (never the build or the server), it fetches the listed files from a **pinned commit**,
 * normalises them and writes `web/src/icons/prusa/<file>.svg` plus the generated
 * `web/src/icons/prusa/index.ts` the `<Icon>` component renders from.
 *
 * Normalisation: near-white fills become `currentColor` (coloured fills stay), the fixed width/height
 * go away, the viewBox stays, XML prolog/comments/presentational junk are dropped, ids are prefixed
 * with the file name (two icons on one page must not share a clip path) and the root svg gets
 * `aria-hidden`/`focusable="false"`. Running it twice writes nothing the second time.
 *
 * `--sheet` regenerates `docs/design/icon-sheet.html` from the same list, so the sheet and the app
 * cannot drift apart. It needs the network too (the roadmap entries are only shown, not vendored).
 *
 * Needs network access; run it from the repository root.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

/** The PrusaSlicer commit the icons are taken from (master head when they were vendored, 3.0.0-alpha12). */
const COMMIT = '30ef59195e0f3ee6f270b185bb5f9fb5f349f81f';
const REPO = 'prusa3d/PrusaSlicer';
const RAW = (file) => `https://raw.githubusercontent.com/${REPO}/${COMMIT}/resources/icons/${file}.svg`;

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = path.join(ROOT, 'web', 'src', 'icons', 'prusa');
const INDEX_FILE = path.join(OUT_DIR, 'index.ts');
const SHEET_FILE = path.join(ROOT, 'docs', 'design', 'icon-sheet.html');

/**
 * The icon map – the same list `docs/design/Icons-and-UX.md` §3 shows. `status` decides what happens:
 * `have` is vendored and used, `roadmap` and `no` only appear on the sheet.
 */
const ICONS = [
  // Tool strip
  {
    group: 'Tool strip',
    name: 'Add object / import',
    file: 'add_object',
    key: null,
    status: 'have',
    today: 'Upload button in the top bar (text)',
  },
  { group: 'Tool strip', name: 'Delete selection', file: 'delete_button', key: 'Del', status: 'have', today: 'Trash2' },
  { group: 'Tool strip', name: 'Add instance', file: 'rectangle_add', key: '+', status: 'have', today: 'Plus' },
  { group: 'Tool strip', name: 'Move', file: 'move', key: 'M', status: 'have', today: 'Move' },
  { group: 'Tool strip', name: 'Rotate', file: 'rotate', key: 'R', status: 'have', today: 'RotateCw' },
  { group: 'Tool strip', name: 'Scale', file: 'scale', key: 'S', status: 'have', today: 'Scaling' },
  { group: 'Tool strip', name: 'Place on face', file: 'place', key: 'F', status: 'have', today: 'PanelBottom' },
  { group: 'Tool strip', name: 'Arrange', file: 'layout', key: 'Q', status: 'have', today: 'LayoutGrid (our key: Shift+A)' },
  { group: 'Tool strip', name: 'Paint-on supports', file: 'paint_supports', key: 'L', status: 'have', today: 'Paintbrush' },
  { group: 'Tool strip', name: 'Paint-on seams', file: 'paint_seams', key: 'P', status: 'have', today: 'Spline' },
  {
    group: 'Tool strip',
    name: 'Multimaterial painting',
    file: 'paint_multi_material',
    key: 'N',
    status: 'have',
    today: 'Palette (no key yet)',
  },
  { group: 'Tool strip', name: 'Cut', file: 'cut', key: 'C', status: 'have', today: 'Scissors' },
  { group: 'Tool strip', name: 'Variable layer height', file: 'variable_layer_height', key: 'V', status: 'have', today: 'Layers3' },
  {
    group: 'Tool strip',
    name: 'Height range (layer range settings)',
    file: 'height_range',
    key: 'W',
    status: 'roadmap',
    today: 'list rows today; becomes a tool with the context panel',
  },
  { group: 'Tool strip', name: 'Simplify', file: 'simplify', key: 'E', status: 'roadmap', today: 'TODO P3' },
  { group: 'Tool strip', name: 'Measure', file: 'ruler', key: 'U', status: 'roadmap', today: 'TODO P3' },
  { group: 'Tool strip', name: 'Emboss text', file: 'text', key: 'T', status: 'roadmap', today: 'TODO P3 (text/SVG embossing)' },
  { group: 'Tool strip', name: 'Paint-on fuzzy skin', file: 'paint_fuzzy_skin', key: 'H', status: 'no', today: 'not planned' },

  // Rail (the far-left column of the 3.0 layout, L-1)
  { group: 'Rail', name: 'Slicing', file: 'lb_slicing', key: null, status: 'have', today: 'the Plater/Preview view tabs' },
  {
    group: 'Rail',
    name: 'Library',
    file: 'lb_projects',
    key: null,
    status: 'have',
    today: 'top bar Library button',
  },
  {
    group: 'Rail',
    name: 'Printers',
    file: 'lb_printers',
    key: null,
    status: 'have',
    today: 'top bar Printers button',
  },
  {
    group: 'Rail',
    name: 'Preferences (gear)',
    file: 'cog',
    key: null,
    status: 'have',
    today: 'the Print/Filament/Printer settings views',
  },
  { group: 'Rail', name: 'About', file: 'info', key: null, status: 'have', today: 'top bar "?" button' },

  // Top bar
  { group: 'Top bar', name: 'Undo', file: 'tb_undo', key: 'Ctrl+Z', status: 'have', today: 'Undo2' },
  { group: 'Top bar', name: 'Redo', file: 'tb_redo', key: 'Ctrl+Y', status: 'have', today: 'Redo2' },
  { group: 'Top bar', name: 'Open / load project', file: 'tb_load', key: 'Ctrl+O', status: 'have', today: 'text button' },
  { group: 'Top bar', name: 'Save project', file: 'tb_save', key: 'Ctrl+S', status: 'have', today: 'Save' },
  {
    group: 'Top bar',
    name: 'Hide / show side panels',
    file: 'tb_show_ui',
    key: null,
    status: 'have',
    today: 'the top bar hide-panels toggle',
  },
  { group: 'Top bar', name: 'Search', file: 'search_gray', key: 'Ctrl+F', status: 'roadmap', today: 'global search, TODO P3' },
  { group: 'Top bar', name: 'New project tab', file: 'plus_new', key: null, status: 'roadmap', today: 'project tabs (D-10)' },

  // Mode
  { group: 'Mode', name: 'Simple mode', file: 'mode_simple', key: null, status: 'have', today: 'select box' },
  { group: 'Mode', name: 'Advanced mode', file: 'mode_advanced', key: null, status: 'have', today: 'select box' },
  { group: 'Mode', name: 'Expert mode', file: 'mode_expert', key: null, status: 'have', today: 'select box' },

  // Object list
  { group: 'Object list', name: 'Object', file: 'object_icon', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Part (solid volume)', file: 'union', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Negative volume', file: 'subtract', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Modifier', file: 'exclude', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Support blocker', file: 'support_blocker', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Support enforcer', file: 'support_enforcer', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Instances', file: 'instances_icon', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Overridden settings marker', file: 'overrides_marker', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Custom supports painted', file: 'fdm_supports', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Custom seam painted', file: 'seam_', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Multimaterial painted', file: 'mmu_segmentation_', key: null, status: 'have', today: 'none' },
  { group: 'Object list', name: 'Sinking object', file: 'sinking', key: null, status: 'roadmap', today: 'floating/sinking objects (D-12)' },
  { group: 'Object list', name: 'Add bed', file: 'add_bed', key: null, status: 'roadmap', today: 'multiple beds (D-11)' },
  { group: 'Object list', name: 'Delete bed', file: 'del_bed', key: null, status: 'roadmap', today: 'multiple beds (D-11)' },
  { group: 'Object list', name: 'Not printed (eye)', file: 'dont_print', key: null, status: 'no', today: 'no feature' },

  // Settings
  { group: 'Settings', name: 'Open settings (cog)', file: 'cog', key: null, status: 'have', today: 'Settings' },
  { group: 'Settings', name: 'Favourite star', file: 'star', key: null, status: 'roadmap', today: 'favourites (D-1)' },
  { group: 'Settings', name: 'Favourite star (set)', file: 'star_solid', key: null, status: 'roadmap', today: 'favourites (D-1)' },
  { group: 'Settings', name: 'Compare presets', file: 'compare', key: null, status: 'roadmap', today: 'TODO P3' },
  { group: 'Settings', name: 'Revert to preset value', file: 'undo_r', key: null, status: 'have', today: 'RotateCcw' },
  { group: 'Settings', name: 'Lock (value equals system preset)', file: 'lock_closed', key: null, status: 'have', today: 'none' },
  { group: 'Settings', name: 'Unlocked (value differs)', file: 'lock_open', key: null, status: 'have', today: 'none' },

  // Presets
  { group: 'Presets', name: 'Printer', file: 'printer', key: null, status: 'have', today: 'none' },
  { group: 'Presets', name: 'Physical printer', file: 'printer_physical', key: null, status: 'have', today: 'none' },
  { group: 'Presets', name: 'Filament', file: 'spool', key: null, status: 'have', today: 'none' },
  { group: 'Presets', name: 'Print settings', file: 'cog', key: null, status: 'have', today: 'none' },
  {
    group: 'Presets',
    name: 'Printer online / busy / offline',
    file: 'printer_available',
    key: null,
    status: 'roadmap',
    today: 'printer status, deferred until hardware beta',
  },
  { group: 'Presets', name: 'Printer offline', file: 'printer_offline', key: null, status: 'roadmap', today: 'printer status, deferred' },

  // Export
  { group: 'Export', name: 'Export G-code', file: 'export_gcode', key: 'Ctrl+G', status: 'have', today: 'text button' },
  { group: 'Export', name: 'Save G-code to local file', file: 'save_print_to_local', key: null, status: 'have', today: 'text button' },
  { group: 'Export', name: 'Send to printer host', file: 'connect_gcode', key: null, status: 'have', today: 'text button' },
  { group: 'Export', name: 'Export config', file: 'export_config', key: null, status: 'have', today: 'text menu' },
  { group: 'Export', name: 'Export config bundle', file: 'export_config_bundle', key: null, status: 'have', today: 'T-059' },
  { group: 'Export', name: 'Import config', file: 'import_config', key: null, status: 'have', today: 'text menu' },
  { group: 'Export', name: 'Import config bundle', file: 'import_config_bundle', key: null, status: 'have', today: 'T-059' },

  // Preview legend
  { group: 'Preview legend', name: 'Travel', file: 'legend_travel', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Wipe', file: 'legend_wipe', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Retractions', file: 'legend_retract', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Deretractions', file: 'legend_deretract', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Seams', file: 'legend_seams', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Tool changes', file: 'legend_toolchanges', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Colour changes', file: 'legend_colorchanges', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Pauses', file: 'legend_pauseprints', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Custom G-codes', file: 'legend_customgcodes', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Shells', file: 'legend_shells', key: null, status: 'have', today: 'colour swatch' },
  { group: 'Preview legend', name: 'Tool marker', file: 'legend_toolmarker', key: null, status: 'have', today: 'colour swatch' },

  // Hints
  { group: 'Hints', name: 'Mouse left / right / wheel / drag', file: 'mouse_left', key: null, status: 'have', today: 'text' },
  { group: 'Hints', name: 'Mouse right', file: 'mouse_right', key: null, status: 'have', today: 'text' },
  { group: 'Hints', name: 'Mouse wheel', file: 'mouse_wheel', key: null, status: 'have', today: 'text' },
  { group: 'Hints', name: 'Mouse drag', file: 'mouse_drag', key: null, status: 'have', today: 'text' },

  // Notifications
  { group: 'Notifications', name: 'Warning', file: 'notification_warning', key: null, status: 'have', today: 'text/colour' },
  { group: 'Notifications', name: 'Error', file: 'notification_error', key: null, status: 'have', today: 'text/colour' },
  { group: 'Notifications', name: 'Info', file: 'notification_info', key: null, status: 'have', today: 'text/colour' },
  { group: 'Notifications', name: 'Close', file: 'notification_close', key: null, status: 'have', today: 'X' },
];

/** File names that must never be vendored: the Prusa logos and the cloud entries. */
const FORBIDDEN = [/^prusaslicer/i, /printables/i, /^connect$/i, /cloud/i, /logo/i];

const GROUPS = [...new Set(ICONS.map((i) => i.group))];
const STATUS_LABEL = { have: 'we have it', roadmap: 'on our roadmap', no: 'not planned' };
const STATUS_CLASS = { have: 'have', roadmap: 'soon', no: 'no' };

const log = (msg) => console.log(`[icons] ${msg}`);

/** Fetch one icon; the network is the only input besides this list. */
async function fetchIcon(file) {
  const res = await fetch(RAW(file), { headers: { 'user-agent': 'webslicer-icon-vendor' } });
  if (!res.ok) throw new Error(`${RAW(file)} → HTTP ${res.status}`);
  return res.text();
}

/** Run `fn` over `items` with at most `limit` requests in flight. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Whether a colour is one of the light greys/whites Prusa's dark theme uses for its neutral tone. */
function isNearWhite(value) {
  const v = value.trim().toLowerCase();
  if (v === 'white') return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!hex) return false;
  const full = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
  const n = parseInt(full, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // near-white (#F7F7F7, #FFF) and the neutral grey (#808080) the secondary strokes use: both are
  // "the current text colour" in Prusa's themed UI, only their lightness differs there
  return (r >= 240 && g >= 240 && b >= 240) || (r === g && g === b && r === 128);
}

/** The root `<svg …>` tag of a file, as the attribute text between `<svg` and `>`. */
function rootTag(source) {
  const m = /<svg\b([^>]*)>/i.exec(source);
  if (!m) throw new Error('no <svg> root');
  return m;
}

function attribute(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : undefined;
}

/**
 * Normalise one fetched file into the inline SVG the app ships: `currentColor` instead of the fixed
 * light grey, no fixed size, prefixed ids, no metadata, one line.
 */
export function normalize(source, file) {
  let svg = source
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const root = rootTag(svg);
  const viewBox = attribute(root[1], 'viewBox');
  if (!viewBox) throw new Error('<svg> without viewBox');
  const usesXlink = /xlink:/.test(svg);

  // the root tag: a canonical attribute set, no size and no Illustrator leftovers
  const head = [
    '<svg',
    ' xmlns="http://www.w3.org/2000/svg"',
    usesXlink ? ' xmlns:xlink="http://www.w3.org/1999/xlink"' : '',
    ` viewBox="${viewBox}"`,
    ' fill="none"',
    ' aria-hidden="true"',
    ' focusable="false"',
    '>',
  ].join('');
  svg = svg.slice(0, root.index) + head + svg.slice(root.index + root[0].length);

  // ids and their references: two different icons on one page must not share a clip path
  svg = svg.replace(/\bid="([^"]*)"/g, (_, id) => `id="${file}--${id}"`).replace(/url\(#([^)]*)\)/g, (_, id) => `url(#${file}--${id})`);
  svg = svg.replace(/\b(xlink:)?href="#([^"]*)"/g, (_, xlink, id) => `${xlink ?? ''}href="#${file}--${id}"`);

  // near-white / neutral-grey artwork follows the button's colour; coloured fills stay as Prusa drew them
  svg = svg.replace(/\b(fill|stroke)="([^"]*)"/g, (all, attr, value) => (isNearWhite(value) ? `${attr}="currentColor"` : all));
  // the same colour in an inline `style` beats the presentation attribute, so it has to follow too
  // (`fill:#ffffff;fill-opacity:1` on a group would otherwise paint over the `currentColor` above)
  svg = svg.replace(/\bstyle="([^"]*)"/g, (all, style) => {
    const rewritten = style.replace(/\b(fill|stroke):([^;]*)/g, (decl, attr, value) => {
      // `fill-opacity` and friends are not colours: only the plain property is rewritten
      return attr === 'fill' || attr === 'stroke' ? (isNearWhite(value) ? `${attr}:currentColor` : decl) : decl;
    });
    return rewritten === style ? all : `style="${rewritten}"`;
  });

  // one line per icon: white space between tags and runs inside attributes carry no meaning here
  return (
    svg
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim() + '\n'
  );
}

/** The generated module the `<Icon>` component reads. */
async function writeIndex(entries) {
  // two functions may share one Prusa file (settings and the print-settings preset both use `cog`)
  const unique = [...new Map(entries.map((e) => [e.file, e])).values()];
  const rows = unique
    .map((e) => `  ${/^[A-Za-z_$][\w$]*$/.test(e.file) ? e.file : JSON.stringify(e.file)}: \`${e.svg.trim()}\`,`)
    .join('\n');
  const source = `/**
 * Generated by \`node scripts/vendor-icons.mjs\` – do not edit; run the script instead.
 *
 * PrusaSlicer icons from prusa3d/PrusaSlicer \`resources/icons/\` at commit ${COMMIT}, recoloured to
 * \`currentColor\`. Licence and source: THIRD_PARTY_NOTICES.md (AGPL-3.0).
 */
export const PRUSA_ICON_COMMIT = '${COMMIT}';

/** The inline SVG of every vendored icon, keyed by its PrusaSlicer file name. */
export const PRUSA_ICONS = {
${rows}
} as const;

export type PrusaIconFile = keyof typeof PRUSA_ICONS;
`;
  return writeFormatted(INDEX_FILE, source, 'typescript');
}

/** Write a generated file through Prettier, so \`format:check\` stays green. */
async function writeFormatted(file, content, parser) {
  const config = (await prettier.resolveConfig(file)) ?? {};
  const formatted = await prettier.format(content, { ...config, filepath: file, parser });
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === formatted) return false;
  fs.writeFileSync(file, formatted);
  return true;
}

const SHEET_CSS = `
      :root {
        --bg: #1b1e24;
        --card: #252a33;
        --text: #e6e8ec;
        --muted: #9aa3b2;
        --accent: #ed6b21;
        --green: #3fb950;
        --yellow: #e3b341;
        --grey: #6b7280;
      }
      @media (prefers-color-scheme: light) {
        :root {
          --bg: #f2f3f5;
          --card: #fff;
          --text: #1b1e24;
          --muted: #5b6472;
        }
      }
      body {
        margin: 0;
        padding: 24px 16px;
        background: var(--bg);
        color: var(--text);
        font:
          14px/1.4 system-ui,
          sans-serif;
      }
      h1 {
        font-size: 20px;
        margin: 0 0 4px;
      }
      p.lead {
        margin: 0 0 20px;
        color: var(--muted);
        max-width: 70ch;
      }
      h2 {
        font-size: 15px;
        margin: 28px 0 10px;
        color: var(--accent);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 10px;
      }
      .card {
        background: var(--card);
        border-radius: 8px;
        padding: 10px 12px;
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .ico {
        flex: none;
        width: 44px;
        height: 44px;
        border-radius: 6px;
        background: #1b1e24;
        color: #e6e8ec;
        display: grid;
        place-items: center;
      }
      .ico svg {
        width: 30px;
        height: 30px;
      }
      .t {
        min-width: 0;
      }
      .n {
        font-weight: 600;
      }
      .m {
        color: var(--muted);
        font-size: 12px;
      }
      .b {
        display: inline-block;
        font-size: 11px;
        padding: 0 6px;
        border-radius: 9px;
        margin-right: 4px;
        color: #10131a;
      }
      .have {
        background: var(--green);
      }
      .soon {
        background: var(--yellow);
      }
      .no {
        background: var(--grey);
        color: #fff;
      }
      kbd {
        font:
          11px ui-monospace,
          monospace;
        border: 1px solid var(--muted);
        border-radius: 3px;
        padding: 0 4px;
        color: var(--muted);
      }
`;

/** The HTML of the visual map, built from the same list (and the same SVGs) as the app. */
export async function renderSheet(icons) {
  const sections = GROUPS.map((group) => {
    const cards = icons
      .filter((i) => i.group === group)
      .map(
        (i) => `      <div class="card">
        <div class="ico">${i.svg.trim()}</div>
        <div class="t">
          <div class="n">${i.name}</div>
          <div class="m"><span class="b ${STATUS_CLASS[i.status]}">${STATUS_LABEL[i.status]}</span>${i.key ? `<kbd>${i.key}</kbd>` : ''}</div>
          <div class="m">today: ${i.today} · <code>${i.file}.svg</code></div>
        </div>
      </div>`,
      )
      .join('\n');
    return `    <h2>${group}</h2>
    <div class="grid">
${cards}
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>WebSlicer – Prusa icon map</title>
    <style>${SHEET_CSS}    </style>
  </head>
  <body>
    <h1>Prusa icon map for WebSlicer</h1>
    <p class="lead">
      One function, one icon, everywhere – the icons PrusaSlicer 3.0 uses for each function (from its repository,
      <code>resources/icons</code>, commit <code>${COMMIT.slice(0, 12)}</code>, AGPL-3.0). Green = we already have the function, yellow =
      on our roadmap, grey = not planned (icon would not be used). Under each name: the Prusa shortcut and what WebSlicer uses today.
      Generated by <code>node scripts/vendor-icons.mjs --sheet</code>.
    </p>
${sections}
  </body>
</html>
`;
}

async function main() {
  const sheetOnly = process.argv.includes('--sheet');
  const wanted = sheetOnly ? ICONS : ICONS.filter((i) => i.status === 'have');
  for (const icon of wanted) {
    for (const forbidden of FORBIDDEN) {
      if (forbidden.test(icon.file)) throw new Error(`refusing to vendor a logo/cloud icon: ${icon.file}.svg`);
    }
  }

  log(`${sheetOnly ? 'sheet' : 'vendoring'} ${wanted.length} icons from ${REPO}@${COMMIT.slice(0, 12)} …`);
  const fetched = await mapLimit(wanted, 8, async (icon) => ({ ...icon, svg: normalize(await fetchIcon(icon.file), icon.file) }));

  if (sheetOnly) {
    const changed = await writeFormatted(SHEET_FILE, await renderSheet(fetched), 'html');
    log(`sheet: docs/design/icon-sheet.html ${changed ? 'rewritten' : 'unchanged'} (${fetched.length} icons)`);
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  for (const icon of fetched) {
    const file = path.join(OUT_DIR, `${icon.file}.svg`);
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === icon.svg) {
      log(`unchanged ${icon.file}.svg`);
      continue;
    }
    fs.writeFileSync(file, icon.svg);
    written++;
    log(`written   ${icon.file}.svg`);
  }
  const indexChanged = await writeIndex(fetched);
  log(`${written} of ${fetched.length} svg files changed, index ${indexChanged ? 'rewritten' : 'unchanged'}`);
}

await main();
