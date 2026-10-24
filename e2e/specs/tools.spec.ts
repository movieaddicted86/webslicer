/**
 * The tool strip and the context panel's tool mode (layout 3.0, L-4).
 *
 * The strip is a floating pill between the two cards at the top of the scene: it opens every registry
 * tool and carries the object commands on the selection. The open tool's controls are the context
 * panel's tool mode (title, ✕, fields, sticky primary action and the key-hint block of its registry
 * entry), not a second box over the scene.
 *
 * The Prepare | Preview switch is the top bar's; the strip carries the tools only, and the switch's
 * describe below reads it from there.
 *
 * The layout moves the controls between regions, so every locator is a hook: `tool-strip`,
 * `tool-bar`, `tool-<id>`, `tool-panel*`, `tool-hints`, `view-switch`.
 */
import { CUBE, importFile, press, read, settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click } from '../helpers/dom';

test.describe('tool strip', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([window.webslicer.getState().objects[0].id]));
    await settle(app, 700);
  });

  test('the strip is a horizontal pill at the top centre of the scene, in registry groups', async ({ app }) => {
    // the mockup's window: at 1440 px the band between the two cards holds every group
    await app.setViewportSize({ width: 1440, height: 900 });
    await settle(app, 700);
    const strip = await app.evaluate(() => {
      const host = document.querySelector('[data-testid="tool-strip"]') as HTMLElement;
      const pill = document.querySelector('[data-testid="tool-bar"]') as HTMLElement;
      const viewer = document.querySelector('.viewer') as HTMLElement;
      const list = document.querySelector('[data-testid="left-column"]') as HTMLElement;
      const panel = document.querySelector('[data-testid="context-panel"]') as HTMLElement;
      const p = pill.getBoundingClientRect();
      const v = viewer.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      const r = panel.getBoundingClientRect();
      return {
        role: pill.getAttribute('role'),
        label: pill.getAttribute('aria-label'),
        groups: Array.from(pill.querySelectorAll('.tool-bar-group')).map((g) => g.getAttribute('data-group')),
        separators: pill.querySelectorAll('.tool-bar-group > .tool-sep').length,
        labels: Array.from(pill.querySelectorAll('.tool-bar-group button')).map((b) => b.getAttribute('aria-label')),
        pressed: Array.from(pill.querySelectorAll('.tool-bar-group button')).map((b) => b.getAttribute('aria-pressed')),
        // the pill floats over the top of the scene, centred in the band between the two cards
        top: Math.round(p.top - v.top),
        centre: Math.round(p.left + p.width / 2 - (l.right + (r.left - l.right) / 2)),
        // and it never slides under a card
        clearLeft: Math.round(p.left - l.right),
        clearRight: Math.round(r.left - p.right),
        horizontal: p.width > p.height,
        hostPointerEvents: getComputedStyle(host).pointerEvents,
      };
    });
    expect(strip.role).toBe('toolbar');
    expect(strip.label).toBe('Tools');
    expect(strip.horizontal).toBe(true);
    expect(strip.top).toBeLessThan(20);
    expect(Math.abs(strip.centre)).toBeLessThan(20);
    expect(strip.clearLeft).toBeGreaterThan(0);
    expect(strip.clearRight).toBeGreaterThan(0);
    // the scene stays reachable around the pill
    expect(strip.hostPointerEvents).toBe('none');

    // PrusaSlicer's order: the selection's command, the instance pair, transform + arrange, paint, cut, layer
    expect(strip.groups).toEqual(['selection', 'instance', 'transform', 'paint', 'cut', 'layer']);
    expect(strip.separators).toBe(6);
    expect(strip.labels).toEqual([
      'Delete selection (Del)',
      'Add instance (+)',
      // the cube has its one instance, so removing one would remove it: the tooltip says why
      'Remove instance (−): the object has one instance',
      'Move (M)',
      'Rotate (R)',
      'Scale (S)',
      'Place on face (F)',
      'Arrange (A)',
      'Arrange settings',
      'Paint supports (L)',
      'Paint seam (P)',
      'Paint extruder: Needs a multi-extruder printer',
      // the cube is one object without modifiers, so the cut is available
      'Cut (C)',
      'Variable layer height (V)',
    ]);
    // no tool is open: the gizmo is in the move mode, so move is the one pressed button
    expect(strip.pressed.map((p, i) => (p === 'true' ? strip.labels[i] : null)).filter(Boolean)).toEqual(['Move (M)']);
  });

  test('a button opens the tool in the context panel, the same button closes it', async ({ app }) => {
    const before = await app.locator('.viewer canvas').boundingBox();
    await click(app, '[data-testid="tool-cut"]', 700);
    expect(await read(app, (s) => s.activeTool)).toBe('cut');

    const panel = await app.evaluate(() => {
      const p = document.querySelector('[data-testid="context-panel"] [data-testid="tool-panel"]') as HTMLElement | null;
      return {
        inPanel: !!p,
        label: p?.getAttribute('aria-label'),
        title: p?.querySelector('[data-testid="tool-panel-title"]')?.textContent,
        close: !!p?.querySelector('[data-testid="tool-panel-close"]'),
        footer: p?.querySelector('[data-testid="tool-panel-foot"]')?.textContent ?? '',
        hints: p?.querySelectorAll('[data-testid="tool-hints"] .tool-hint').length ?? 0,
        // tool mode replaces the plate/object content and its Slice footer
        sliceFooter: !!document.querySelector('[data-testid="context-footer"]'),
        // the strip marks the open tool and only that one
        pressed: Array.from(document.querySelectorAll('[data-testid="tool-bar"] button[aria-pressed="true"]')).map((b) =>
          b.getAttribute('aria-label'),
        ),
      };
    });
    expect(panel.inPanel).toBe(true);
    expect(panel.label).toBe('Cut');
    expect(panel.title).toBe('Cut');
    expect(panel.close).toBe(true);
    expect(panel.footer).toContain('Perform cut');
    expect(panel.hints).toBeGreaterThanOrEqual(1);
    expect(panel.sliceFooter).toBe(false);
    expect(panel.pressed).toEqual(['Cut (C)']);

    // the panel is a column, not an overlay: the canvas keeps its size
    expect(await app.locator('.viewer canvas').boundingBox()).toEqual(before);

    await click(app, '[data-testid="tool-cut"]', 700);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
    expect(await app.locator('[data-testid="tool-panel"]').count()).toBe(0);
    await expect(app.locator('[data-testid="context-footer"]')).toBeVisible();
  });

  test('one tool at a time: opening another tool replaces the panel', async ({ app }) => {
    await click(app, '[data-testid="tool-cut"]', 700);
    await click(app, '[data-testid="tool-layerHeight"]', 700);
    expect(await read(app, (s) => ({ tool: s.activeTool, selected: s.selectedIds.length }))).toEqual({
      tool: 'layerHeight',
      selected: 1,
    });
    expect(await app.locator('[data-testid="tool-panel"]').count()).toBe(1);
    await expect(app.locator('[data-testid="tool-panel-title"]')).toHaveText('Variable layer height');
  });

  test('Esc and the close button leave the tool without touching the selection', async ({ app }) => {
    await click(app, '[data-testid="tool-placeOnFace"]', 700);
    expect(await read(app, (s) => s.activeTool)).toBe('placeOnFace');
    await press(app, 'Escape');
    await settle(app, 300);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({
      tool: null,
      selected: 1,
    });

    await click(app, '[data-testid="tool-paintSeam"]', 1200);
    expect(await read(app, (s) => s.activeTool)).toBe('paintSeam');
    await click(app, '[data-testid="tool-panel-close"]', 700);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({
      tool: null,
      selected: 1,
    });
  });

  test('every tool panel carries its key hints, built from the registry', async ({ app }) => {
    for (const [tool, row] of [
      ['cut', 'Turn the object in the 3D view; the plane follows the sliders'],
      ['paintSupports', 'Paint with the selected brush tool'],
      ['placeOnFace', 'Click the face that should lie flat on the bed'],
      ['layerHeight', 'Drag in the chart to raise or lower the layer height'],
    ] as const) {
      await app.evaluate((id) => window.webslicer.getState().openTool(id as never), tool);
      await settle(app, 500);
      await expect(app.locator('[data-testid="tool-hints"]')).toBeVisible();
      await expect(app.locator('[data-testid="tool-hints"]')).toContainText(row);
      // a hint shows a key chip or a mouse icon, never bare text
      expect(
        await app.evaluate(
          () =>
            Array.from(document.querySelectorAll('[data-testid="tool-hints"] .tool-hint')).length > 0 &&
            Array.from(document.querySelectorAll('[data-testid="tool-hints"] .tool-hint')).every(
              (h) => !!h.querySelector('kbd') || !!h.querySelector('svg'),
            ),
        ),
      ).toBe(true);
      await press(app, 'Escape');
      await settle(app, 300);
    }
  });

  test('the tool shortcuts open the same tools, in the context panel', async ({ app }) => {
    for (const [key, tool] of [
      ['c', 'cut'],
      ['v', 'layerHeight'],
      ['f', 'placeOnFace'],
    ] as const) {
      await press(app, key);
      await settle(app, 600);
      expect(await read(app, (s) => s.activeTool), `${key} opens ${tool}`).toBe(tool);
      await expect(app.locator('[data-testid="context-panel"] [data-testid="tool-panel"]')).toBeVisible();
      await press(app, 'Escape');
      await settle(app, 300);
    }
  });

  test('an unavailable tool is disabled and its tooltip says why', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 500);
    const unavailable = await app.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="tool-bar"] button'))
        .map((b) => ({ title: b.getAttribute('title'), disabled: (b as HTMLButtonElement).disabled }))
        .filter((b) => b.disabled),
    );
    expect(unavailable.map((b) => b.title)).toEqual([
      // the object commands need a selection; arrange needs an object, and there is one on the plate
      'Delete selection (Del): select an object first',
      'Add instance (+): select an object first',
      'Remove instance (−): select an object first',
      // the paint, cut and layer tools work on one object and say so
      'Paint supports (L): Select one object',
      'Paint seam (P): Select one object',
      'Paint extruder: Select one object',
      'Cut (C): Select one object',
      'Variable layer height (V): Select one object',
    ]);
    // the transform tools and place-on-face need an object on the plate, not a selection
    await expect(app.locator('[data-testid="tool-move"]')).toBeEnabled();
    await expect(app.locator('[data-testid="tool-placeOnFace"]')).toBeEnabled();
    // a disabled button cannot be opened
    await app.evaluate(() => window.webslicer.getState().openTool('cut'));
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
  });

  test('the object commands have their one home in the strip', async ({ app }) => {
    // the old object toolbar keeps the list-level actions only
    expect(
      await app.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="object-toolbar"] button')).map((b) => b.getAttribute('aria-label')),
      ),
    ).toEqual(['Merge: select two or more objects with a single instance', 'Duplicate', 'Delete all']);
    // arrange, the instance pair and delete exist once – in the strip
    for (const id of ['tool-deleteSelection', 'tool-addInstance', 'tool-removeInstance', 'tool-arrange', 'tool-arrangeSettings']) {
      expect(await app.locator(`[data-testid="${id}"]`).count(), `${id} has one home`).toBe(1);
    }

    // the commands act on the selection like the shortcuts do
    await click(app, '[data-testid="tool-addInstance"]', 600);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(2);
    await click(app, '[data-testid="tool-removeInstance"]', 600);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(1);
    await click(app, '[data-testid="tool-arrange"]', 700);
    expect(await read(app, (s) => s.objects.length)).toBe(1);
    await click(app, '[data-testid="tool-deleteSelection"]', 700);
    expect(await read(app, (s) => s.objects.length)).toBe(0);
  });
});

test.describe('top bar: the Prepare | Preview switch', () => {
  test('the switch is a radiogroup in the top bar and drives the view like the old tabs', async ({ app }) => {
    await importFile(app, CUBE);
    const sw = await app.evaluate(() => {
      const el = document.querySelector('[data-testid="view-switch"]') as HTMLElement;
      return {
        role: el.getAttribute('role'),
        radios: Array.from(el.querySelectorAll('button')).map((b) => ({
          role: b.getAttribute('role'),
          label: b.getAttribute('aria-label'),
          checked: b.getAttribute('aria-checked'),
          nav: b.getAttribute('data-nav-id'),
        })),
      };
    });
    expect(sw.role).toBe('radiogroup');
    expect(sw.radios.map((r) => r.label)).toEqual(['Prepare', 'Preview']);
    expect(sw.radios.map((r) => r.nav)).toEqual(['viewPlater', 'viewPreview']);
    expect(sw.radios[0].checked).toBe('true');

    // both glyphs are drawn at a normal window width: the label's `span` rule once hid the SVG's own
    // `.ui-icon` wrapper as well and left an empty button behind
    const glyphs = await app.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="view-switch"] button svg')).map((s) => {
        const box = s.getBoundingClientRect();
        return Math.round(box.width) > 8 && Math.round(box.height) > 8;
      }),
    );
    expect(glyphs).toEqual([true, true]);

    await click(app, '[data-testid="view-preview"]', 1200);
    expect(await read(app, (s) => s.view)).toBe('preview');
    expect(
      await app.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="view-switch"] button')).map((b) => b.getAttribute('aria-checked')),
      ),
    ).toEqual(['false', 'true']);

    await click(app, '[data-testid="view-plater"]', 800);
    expect(await read(app, (s) => s.view)).toBe('plater');
    // one home for the two views: the strip carries no switch and the bar no view tabs
    expect(await app.evaluate(() => document.querySelector('[data-testid="tool-bar"] [data-testid="view-switch"]'))).toBeNull();
    expect(await app.evaluate(() => document.querySelectorAll('[data-testid="top-bar"] nav').length)).toBe(0);
  });
});

test.describe('tool strip: room, names and overflow', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([window.webslicer.getState().objects[0].id]));
    await settle(app, 700);
  });

  test('the names appear while the whole strip fits with them, and only then', async ({ app }) => {
    // a very wide window: the scene has room for the names beside the icons
    await app.setViewportSize({ width: 2560, height: 900 });
    await settle(app, 700);
    const wide = await app.evaluate(() => {
      const pill = document.querySelector('[data-testid="tool-bar"]') as HTMLElement;
      return {
        labelled: pill.classList.contains('with-labels'),
        labels: Array.from(pill.querySelectorAll('.btn-label')).map((l) => l.textContent),
        overflow: !!pill.querySelector('[data-testid="tool-overflow"]'),
      };
    });
    expect(wide.labelled).toBe(true);
    expect(wide.labels).toContain('Move');
    // the short name of the row, not the panel title ("Variable layer height")
    expect(wide.labels).toContain('Layer height');
    expect(wide.overflow).toBe(false);

    // the default 1280 px window has icons only, with the tooltips as names
    await app.setViewportSize({ width: 1280, height: 900 });
    await settle(app, 700);
    const normal = await app.evaluate(() => {
      const pill = document.querySelector('[data-testid="tool-bar"]') as HTMLElement;
      return {
        labelled: pill.classList.contains('with-labels'),
        labels: pill.querySelectorAll('.btn-label').length,
        title: pill.querySelector('[data-testid="tool-move"]')?.getAttribute('title'),
      };
    });
    expect(normal.labelled).toBe(false);
    expect(normal.labels).toBe(0);
    expect(normal.title).toBe('Move (M)');
  });

  test('a scene too narrow for every group moves the trailing ones into the overflow menu', async ({ app }) => {
    await app.setViewportSize({ width: 1000, height: 900 });
    await settle(app, 700);
    // the pill keeps the leading groups; whatever does not fit sits behind "⋯"
    await expect(app.locator('[data-testid="tool-overflow"]')).toBeVisible();
    const pillTitles = await app.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="tool-bar"] .tool-bar-group button')).map((b) => b.getAttribute('title')),
    );
    expect(pillTitles).toContain('Delete selection (Del)');
    expect(pillTitles).toContain('Move (M)');
    expect(pillTitles).not.toContain('Cut (C)');

    await click(app, '[data-testid="tool-overflow"]', 300);
    await expect(app.locator('[data-testid="tool-overflow-menu"]')).toBeVisible();
    // the menu lists the same entries, with the same names, keys and disabled reasons. Which groups
    // the pill still holds depends on the fits' estimates, so the assertion is structural: nothing
    // appears twice, the menu holds the trailing groups, and every key chip matches the title
    const menu = await app.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="tool-overflow-menu"] button')).map((b) => ({
        title: b.getAttribute('title') ?? '',
        key: b.querySelector('kbd')?.textContent ?? '',
      })),
    );
    expect(menu.length).toBeGreaterThan(0);
    for (const entry of menu) expect(pillTitles).not.toContain(entry.title);
    expect(menu.at(-1)?.title).toBe('Variable layer height (V)');
    expect(menu.map((m) => m.key)).toEqual(menu.map((m) => /\((\w)\)$/.exec(m.title)?.[1] ?? ''));

    // choosing a tool from the menu closes it and opens the tool in the context panel
    await click(app, '[data-testid="tool-overflow-cut"]', 700);
    expect(await read(app, (s) => s.activeTool)).toBe('cut');
    expect(await app.locator('[data-testid="tool-overflow-menu"]').count()).toBe(0);
    await expect(app.locator('[data-testid="context-panel"] [data-testid="tool-panel-title"]')).toHaveText('Cut');

    // Esc closes the reopened menu first, not the tool behind it
    await click(app, '[data-testid="tool-overflow"]', 300);
    await expect(app.locator('[data-testid="tool-overflow-menu"]')).toBeVisible();
    await press(app, 'Escape');
    await settle(app, 300);
    expect(await app.locator('[data-testid="tool-overflow-menu"]').count()).toBe(0);
    expect(await read(app, (s) => s.activeTool)).toBe('cut');
  });

  test('below 900 px the pill scrolls instead of hiding groups behind a menu', async ({ app }) => {
    await app.setViewportSize({ width: 880, height: 700 });
    await settle(app, 800);
    const compact = await app.evaluate(() => {
      const pill = document.querySelector('[data-testid="tool-bar"]') as HTMLElement;
      return {
        compact: pill.classList.contains('compact'),
        overflowX: getComputedStyle(pill).overflowX,
        groups: pill.querySelectorAll('.tool-bar-group').length,
        overflow: !!pill.querySelector('[data-testid="tool-overflow"]'),
        // every group is still reachable by scrolling inside the pill
        scrollable: pill.scrollWidth > pill.clientWidth,
      };
    });
    expect(compact.compact).toBe(true);
    expect(compact.overflowX).toBe('auto');
    expect(compact.groups).toBe(6);
    expect(compact.overflow).toBe(false);
    expect(compact.scrollable).toBe(true);
  });
});
