/**
 * T-046: the tool framework – the left tool bar and the panel docked next to it.
 *
 * The bar is the single way into a tool now (the sidebar keeps its own object toolbar for the
 * frequently used commands): a button opens the tool's panel, the same button closes it, Esc and the
 * panel's close button do the same, and a disabled tool says why. AC-5 measures the panel width; a
 * dummy tool proves AC-3 in `web/src/three/shortcuts.test.ts` and `web/src/tools/activate.test.ts`
 * (a registry entry is all a tool needs), so this spec drives the tools that exist.
 *
 * T-055: the bar shows a short label next to the icon while the 3D view is wide enough (measured on
 * the view, not the window), the toggle at the bar's end overrides that and `localStorage` remembers
 * the choice; the sidebar's object toolbar keeps no tool buttons any more (no action twice).
 */
import { CUBE, importFile, press, read, settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click } from '../helpers/dom';

test.describe('tool framework', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([window.webslicer.getState().objects[0].id]));
    await settle(app, 700);
  });

  test('the bar is vertical at the left edge and holds one button per registry tool', async ({ app }) => {
    const bar = await app.evaluate(() => {
      const el = document.querySelector('.tool-bar') as HTMLElement;
      const viewer = document.querySelector('.viewer') as HTMLElement;
      const b = el.getBoundingClientRect();
      const v = viewer.getBoundingClientRect();
      return {
        role: el.getAttribute('role'),
        orientation: el.getAttribute('aria-orientation'),
        labels: Array.from(el.querySelectorAll('button')).map((x) => x.getAttribute('aria-label')),
        groups: el.querySelectorAll('.tool-bar-group').length,
        separators: el.querySelectorAll('.tool-sep').length,
        // the bar sits on the left edge of the 3D view, vertically centred
        leftOffset: Math.round(b.left - v.left),
        centreOffset: Math.round(b.top + b.height / 2 - (v.top + v.height / 2)),
        vertical: b.height > b.width,
        icons: Array.from(el.querySelectorAll('button svg')).map((s) => s.getAttribute('width')),
      };
    });
    expect(bar.role).toBe('toolbar');
    expect(bar.orientation).toBe('vertical');
    expect(bar.vertical).toBe(true);
    expect(bar.leftOffset).toBeLessThan(20);
    expect(Math.abs(bar.centreOffset)).toBeLessThan(30);
    expect(bar.labels).toEqual([
      'Move (M)',
      'Rotate (R)',
      'Scale (S)',
      'Place on face (F)',
      // the cube is one object without modifiers, so the cut is available
      'Cut (C)',
      'Variable layer height (V)',
      'Paint supports (L)',
      'Paint seam (P)',
      'Paint extruder: Needs a multi-extruder printer',
      // T-055: the label toggle closes the bar
      'Show tool labels',
    ]);
    // three groups: transform | edit | paint
    expect(bar.groups).toBe(3);
    expect(bar.icons).toEqual(Array(10).fill('18'));
    // the label toggle sits behind its own separator
    expect(bar.separators).toBe(3);
  });

  test('a button opens its panel next to the bar, the same button closes it', async ({ app }) => {
    await click(app, '.tool-bar button[title="Cut (C)"]', 700);
    expect(await read(app, (s) => s.activeTool)).toBe('cut');
    const panel = await app.evaluate(() => {
      const p = document.querySelector('.tool-panel') as HTMLElement;
      const bar = document.querySelector('.tool-bar') as HTMLElement;
      const b = p.getBoundingClientRect();
      return {
        label: p.getAttribute('aria-label'),
        title: p.querySelector('.tool-panel-title')?.textContent,
        close: !!p.querySelector('.tool-panel-close'),
        footer: p.querySelector('.tool-panel-foot')?.textContent ?? '',
        // AC-5: at most 320 px wide, and docked to the right of the bar
        width: Math.round(b.width),
        left: Math.round(b.left),
        barRight: Math.round(bar.getBoundingClientRect().right),
      };
    });
    expect(panel.label).toBe('Cut');
    expect(panel.title).toBe('Cut');
    expect(panel.close).toBe(true);
    expect(panel.footer).toContain('Perform cut');
    expect(panel.width).toBeLessThanOrEqual(320);
    expect(panel.left).toBeGreaterThanOrEqual(panel.barRight);

    // the open tool is the highlighted one, and only that one
    expect(
      await app.evaluate(() => Array.from(document.querySelectorAll('.tool-bar button.active')).map((b) => b.getAttribute('aria-label'))),
    ).toEqual(['Cut (C)']);

    // the same button toggles the panel off
    await click(app, '.tool-bar button[title="Cut (C)"]', 700);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
    expect(await app.locator('.tool-panel').count()).toBe(0);
  });

  test('one tool at a time: opening another tool replaces the panel', async ({ app }) => {
    await click(app, '.tool-bar button[title="Cut (C)"]', 700);
    await click(app, '.tool-bar button[title="Variable layer height (V)"]', 700);
    const both = await read(app, (s) => ({ tool: s.activeTool, selected: s.selectedIds.length }));
    expect(both).toEqual({ tool: 'layerHeight', selected: 1 });
    expect(await app.locator('.tool-panel').count()).toBe(1);
    await expect(app.locator('.tool-panel-title')).toHaveText('Variable layer height');
  });

  test('Esc and the close button leave the tool without touching the selection', async ({ app }) => {
    await click(app, '.tool-bar button[title="Place on face (F)"]', 700);
    expect(await read(app, (s) => s.activeTool)).toBe('placeOnFace');
    await press(app, 'Escape');
    await settle(app, 300);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({ tool: null, selected: 1 });

    await click(app, '.tool-bar button[title="Paint seam (P)"]', 1200);
    expect(await read(app, (s) => s.activeTool)).toBe('paintSeam');
    await click(app, '.tool-panel-close', 700);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({ tool: null, selected: 1 });
  });

  test('the tool shortcuts open the same panels', async ({ app }) => {
    for (const [key, tool] of [
      ['c', 'cut'],
      ['v', 'layerHeight'],
      ['f', 'placeOnFace'],
    ] as const) {
      await press(app, key);
      await settle(app, 600);
      expect(await read(app, (s) => s.activeTool), `${key} opens ${tool}`).toBe(tool);
      await press(app, 'Escape');
      await settle(app, 300);
    }
  });

  test('an unavailable tool is disabled and its tooltip says why', async ({ app }) => {
    // no selection: every tool that works on one object is disabled with that reason
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 500);
    const unavailable = await app.evaluate(() =>
      Array.from(document.querySelectorAll('.tool-bar button'))
        .map((b) => ({ title: b.getAttribute('title'), disabled: (b as HTMLButtonElement).disabled }))
        .filter((b) => b.disabled),
    );
    expect(unavailable.map((b) => b.title)).toEqual([
      'Cut (C): Select one object',
      'Variable layer height (V): Select one object',
      'Paint supports (L): Select one object',
      'Paint seam (P): Select one object',
      'Paint extruder: Select one object',
    ]);
    // the transform tools and place-on-face need an object on the plate, not a selection: there is one
    await expect(app.locator('.tool-bar button[title="Move (M)"]')).toBeEnabled();
    await expect(app.locator('.tool-bar button[title="Place on face (F)"]')).toBeEnabled();
    // a disabled button cannot be opened
    await app.evaluate(() => window.webslicer.getState().openTool('cut'));
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
  });

  test('the sidebar renders no tool options any more', async ({ app }) => {
    // the old option panels left the sidebar; the object list and its manipulation panel stay
    expect(await app.locator('.sidebar .cut-panel, .sidebar .paint-panel, .sidebar .layer-profile-panel').count()).toBe(0);
    expect(await app.locator('.sidebar button:has-text("Perform cut")').count()).toBe(0);
    expect(await app.locator('.sidebar button:has-text("Adaptive")').count()).toBe(0);
    expect(await app.locator('.manip').count()).toBe(1);
    // T-055: and no action is offered twice – the tool buttons exist in the bar only
    expect(
      await app.evaluate(() =>
        Array.from(document.querySelectorAll('.sidebar .objects .tools button')).map((b) => b.getAttribute('aria-label')),
      ),
    ).toEqual([
      'Undo (Ctrl+Z)',
      'Redo (Ctrl+Y)',
      'Arrange (A)',
      'Arrange settings',
      'Add instance (+)',
      'Remove the last instance (−)',
      'Merge: select two or more objects with a single instance',
      'Duplicate',
      'Delete the picked instance, otherwise the selected object or volume (Del)',
      'Delete all',
    ]);
  });

  test('the bar shows labels on a wide view, icons only on a narrow one, and stays under 170 px (T-055)', async ({ app }) => {
    // the labels follow the width of the 3D view, not the window: 1600 px window − 340 px sidebar
    await app.setViewportSize({ width: 1600, height: 900 });
    await settle(app, 500);
    const wide = await app.evaluate(() => {
      const bar = document.querySelector('.tool-bar') as HTMLElement;
      return {
        labelled: bar.classList.contains('with-labels'),
        viewWidth: Math.round((bar.parentElement as HTMLElement).getBoundingClientRect().width),
        width: Math.round(bar.getBoundingClientRect().width),
        labels: Array.from(bar.querySelectorAll('.tool-bar-tool .btn-label')).map((l) => l.textContent),
      };
    });
    expect(wide.viewWidth).toBeGreaterThanOrEqual(1100);
    expect(wide.labelled).toBe(true);
    expect(wide.labels).toEqual([
      'Move',
      'Rotate',
      'Scale',
      'Place on face',
      'Cut',
      'Layer height',
      'Paint supports',
      'Paint seam',
      'Paint extruder',
    ]);
    // AC from the task: the bar must not cover more than ~170 px of the view
    expect(wide.width).toBeLessThanOrEqual(170);

    // 1100 × 800 leaves well under 1100 px for the view: icons only, with the tooltips
    await app.setViewportSize({ width: 1100, height: 800 });
    await settle(app, 500);
    const narrow = await app.evaluate(() => {
      const bar = document.querySelector('.tool-bar') as HTMLElement;
      return {
        labelled: bar.classList.contains('with-labels'),
        viewWidth: Math.round((bar.parentElement as HTMLElement).getBoundingClientRect().width),
        labels: bar.querySelectorAll('.btn-label').length,
        title: bar.querySelector('.tool-bar-tool')?.getAttribute('title'),
      };
    });
    expect(narrow.viewWidth).toBeLessThan(1100);
    expect(narrow.labelled).toBe(false);
    expect(narrow.labels).toBe(0);
    expect(narrow.title).toBe('Move (M)');

    // the toggle overrides the width and the browser remembers the choice across a reload
    await click(app, '.tool-bar .tool-bar-labels', 400);
    await expect(app.locator('.tool-bar')).toHaveClass(/with-labels/);
    await expect(app.locator('.tool-bar-tool .btn-label').first()).toHaveText('Move');
    await app.reload({ waitUntil: 'networkidle' });
    await app.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
    await settle(app, 800);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.toolLabels'))).toBe('on');
    await expect(app.locator('.tool-bar')).toHaveClass(/with-labels/, { timeout: 10_000 });
    await expect(app.locator('.tool-bar-tool .btn-label').first()).toHaveText('Move');

    // and off again, still narrow → icons only, and that is remembered too
    await click(app, '.tool-bar .tool-bar-labels', 400);
    await expect(app.locator('.tool-bar')).not.toHaveClass(/with-labels/);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.toolLabels'))).toBe('off');
  });
});
