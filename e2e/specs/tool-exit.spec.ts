/**
 * Leaving a tool, and the column that must never be empty while one is open (T-072).
 *
 * Two defects from Robert's finding: a strip tool without a panel (move/rotate/scale) put the context
 * panel into tool mode with nothing to render – no presets, no printer, no Slice button – and a click
 * on the empty scene did not bring the default panel back. The spec walks every strip tool and pins
 * that the column always offers the tool's own frame or the Slice footer, that a click on empty space
 * ends the tool (with its cleanup) and clears the selection, and that an orbit drag is not such a click.
 *
 * Clicking an object stays what it was: it selects (or paints) and leaves the open tool alone.
 *
 * T-075 / Z-03: the ✕ of every panel is a real, recognisable button – at least 28 × 28 px, in the
 * head's top right, titled "Close (Esc)" and reachable by keyboard. The test pins the hit area and the
 * tooltip for every panel tool and clicks it once per panel.
 */
import { CUBE, importFile, press, read, settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click } from '../helpers/dom';
import { canvasBox } from '../helpers/plater';

/** The strip tools the 20 mm cube can open (paint extruder needs a multi-extruder printer). */
const TOOLS = ['move', 'rotate', 'scale', 'placeOnFace', 'paintSupports', 'paintSeam', 'cut', 'layerHeight'] as const;

/** The tools that own a panel; the transform trio only drives the gizmo. */
const PANEL_TOOLS: ReadonlySet<string> = new Set(['placeOnFace', 'paintSupports', 'paintSeam', 'cut', 'layerHeight']);

/** What the context panel offers right now: the tool's frame, the Slice footer, both or neither. */
const column = (app: Parameters<typeof read>[0]) =>
  app.evaluate(() => {
    const panel = document.querySelector('[data-testid="context-panel"]') as HTMLElement | null;
    // the footer card (Destination + Slice) is the panel's sibling in `.context-stack`, not its child
    const stack = panel?.closest('.context-stack') ?? panel;
    return {
      activeTool: window.webslicer.getState().activeTool ?? null,
      toolPanel: !!panel?.querySelector('[data-testid="tool-panel"]'),
      title: panel?.querySelector('[data-testid="tool-panel-title"]')?.textContent?.trim() ?? null,
      slice: !!stack?.querySelector('[data-testid="slice-button"]'),
      text: (stack?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });

/** A click in a corner of the scene no card and no overlay covers. */
async function clickEmptyScene(app: Parameters<typeof read>[0]): Promise<void> {
  const box = await canvasBox(app);
  await app.mouse.click(box.x + 30, box.y + box.height - 30);
  await settle(app, 600);
}

/** Whether the cut plane is still drawn in the 3D view (the tool's scene cleanup). */
const cutPlaneDrawn = (app: Parameters<typeof read>[0]) =>
  app.evaluate(() => {
    let found = false;
    window.__wsScene().traverse((o) => {
      if (o.name === 'cut-plane' && o.visible) found = true;
    });
    return found;
  });

test.describe('tool exit and the context panel (T-072)', () => {
  test.beforeEach(async ({ app }) => {
    await app.setViewportSize({ width: 1440, height: 900 });
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);
  });

  test('every panel carries a recognisable ✕ top right that closes it (Z-03)', async ({ app }) => {
    for (const id of PANEL_TOOLS) {
      await click(app, `[data-testid="tool-${id}"]`, 800);
      expect(await read(app, (s) => s.activeTool), `${id} is open`).toBe(id);

      const close = app.locator('[data-testid="tool-panel-close"]');
      await expect(close, `${id} has one close button`).toHaveCount(1);
      await expect(close, `${id}: its tooltip names the action and Esc`).toHaveAttribute('title', 'Close (Esc)');
      // Z-03: a real 28 px hit area, and it sits in the head's top right corner
      const box = await close.boundingBox();
      expect(box?.width ?? 0, `${id}: the ✕ is at least 28 px wide`).toBeGreaterThanOrEqual(28);
      expect(box?.height ?? 0, `${id}: the ✕ is at least 28 px tall`).toBeGreaterThanOrEqual(28);
      const where = await app.evaluate(() => {
        const head = document.querySelector('[data-testid="tool-panel"] .tool-panel-head') as HTMLElement | null;
        const button = head?.querySelector('[data-testid="tool-panel-close"]') as HTMLElement | null;
        if (!head || !button) return null;
        const h = head.getBoundingClientRect();
        const b = button.getBoundingClientRect();
        return { right: h.right - b.right, top: b.top - h.top };
      });
      expect(where, `${id}: the ✕ lives in the panel head`).not.toBeNull();
      expect(where!.right, `${id}: the ✕ is at the head's right edge`).toBeLessThanOrEqual(2);
      expect(where!.top, `${id}: the ✕ is at the head's top`).toBeLessThanOrEqual(6);

      // keyboard focusable, and a click closes the tool like Esc does (the selection stays)
      await close.focus();
      expect(await app.evaluate(() => document.activeElement?.getAttribute('data-testid')), `${id}: focus reaches the ✕`).toBe(
        'tool-panel-close',
      );
      await close.click();
      await settle(app, 400);
      expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length })), `${id} closed`).toEqual({
        tool: null,
        selected: 1,
      });
      await expect(app.locator('[data-testid="tool-panel"]'), `${id}: the panel is gone`).toHaveCount(0);
    }

    // the third paint panel needs several extruders; it is the same frame, so it carries the same ✕
    await app.evaluate(() => window.webslicer.getState().setOption('printer', 'nozzle_diameter', '0.4,0.4,0.4,0.4,0.4,0.4'));
    await settle(app, 1800);
    expect(await read(app, (s) => s.extruderCount())).toBe(6);
    await click(app, '[data-testid="tool-paintMmu"]', 900);
    expect(await read(app, (s) => s.activeTool)).toBe('paintMmu');
    const mmuClose = app.locator('[data-testid="tool-panel-close"]');
    await expect(mmuClose).toHaveAttribute('title', 'Close (Esc)');
    const mmuBox = await mmuClose.boundingBox();
    expect(mmuBox?.width ?? 0).toBeGreaterThanOrEqual(28);
    expect(mmuBox?.height ?? 0).toBeGreaterThanOrEqual(28);
    await mmuClose.click();
    await settle(app, 400);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
  });

  test('every strip tool leaves the column usable: its own panel, or the default panel with Slice', async ({ app }) => {
    for (const id of TOOLS) {
      await click(app, `[data-testid="tool-${id}"]`, 800);
      const now = await column(app);
      // a tool with a panel opens it; a gizmo tool never becomes "tool open" – the panel keeps the
      // object and, with it, the Slice footer. Neither may leave the column blank.
      expect(now.text.length, `${id}: the column is not empty`).toBeGreaterThan(0);
      expect(now.toolPanel || now.slice, `${id}: the column offers a tool frame or the Slice footer`).toBe(true);
      if (PANEL_TOOLS.has(id)) {
        expect(now.activeTool, `${id} is open`).toBe(id);
        expect(now.toolPanel, `${id} shows its own frame`).toBe(true);
        expect(now.title?.length ?? 0, `${id} names its panel`).toBeGreaterThan(0);
      } else {
        expect(now.activeTool, `${id} is a gizmo mode, not an open panel tool`).toBeNull();
        expect(now.toolPanel, `${id} opens no tool panel`).toBe(false);
        expect(now.slice, `${id} keeps the Slice footer`).toBe(true);
      }
    }

    // the last tool closes by its own strip button and the default panel returns
    await click(app, `[data-testid="tool-${TOOLS[TOOLS.length - 1]}"]`, 800);
    const back = await column(app);
    expect(back.activeTool).toBeNull();
    expect(back.toolPanel).toBe(false);
    expect(back.slice).toBe(true);
    await expect(app.locator('[data-testid="context-footer"]')).toBeVisible();
  });

  test('a click on the empty scene ends the cut tool, cleans the plane up and clears the selection', async ({ app }) => {
    await click(app, '[data-testid="tool-cut"]', 800);
    expect(await cutPlaneDrawn(app), 'the cut plane is drawn while the tool is open').toBe(true);

    await clickEmptyScene(app);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({
      tool: null,
      selected: 0,
    });
    expect(await cutPlaneDrawn(app), 'the cut plane goes with the tool').toBe(false);
    const back = await column(app);
    expect(back.toolPanel).toBe(false);
    // plate mode: the presets and the Slice footer are back
    expect(back.slice).toBe(true);
    await expect(app.locator('[data-testid="context-footer"]')).toBeVisible();
    await expect(app.locator('[data-testid="presets"]')).toBeVisible();
  });

  test('a click on the object keeps the tool open (picking behaves as before)', async ({ app }) => {
    await click(app, '[data-testid="tool-cut"]', 800);
    const box = await canvasBox(app);
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await settle(app, 600);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({
      tool: 'cut',
      selected: 1,
    });
    expect(await cutPlaneDrawn(app)).toBe(true);
  });

  test('an orbit drag on the empty scene does not end the tool', async ({ app }) => {
    await click(app, '[data-testid="tool-layerHeight"]', 800);
    const box = await canvasBox(app);
    await app.mouse.move(box.x + 30, box.y + box.height - 80);
    await app.mouse.down();
    await app.mouse.move(box.x + 120, box.y + box.height - 120, { steps: 10 });
    await app.mouse.up();
    await settle(app, 600);
    expect(await read(app, (s) => s.activeTool)).toBe('layerHeight');
    expect(await app.locator('[data-testid="tool-panel"]').count()).toBe(1);
  });

  test('the brush of a closed paint tool paints nothing: the empty click ends the stroke mode too', async ({ app }) => {
    await press(app, 'l');
    await settle(app, 2000);
    expect(await read(app, (s) => s.activeTool)).toBe('paintSupports');

    const box = await canvasBox(app);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // one stroke proves the tool works
    await app.mouse.move(cx, cy - 30);
    await app.mouse.down();
    await app.mouse.move(cx + 25, cy - 10, { steps: 6 });
    await app.mouse.up();
    await settle(app, 1200);
    const painted = await read(app, (s) =>
      s.objects[0].paint?.supports ? Array.from(s.objects[0].paint.supports).filter(Boolean).length : 0,
    );
    expect(painted).toBeGreaterThan(0);

    // the empty click ends the tool and clears the selection
    await clickEmptyScene(app);
    expect(await read(app, (s) => ({ tool: s.activeTool ?? null, selected: s.selectedIds.length }))).toEqual({
      tool: null,
      selected: 0,
    });

    // a second stroke over the model now paints nothing – the brush belongs to the closed tool
    await app.mouse.move(cx, cy - 30);
    await app.mouse.down();
    await app.mouse.move(cx + 25, cy - 10, { steps: 6 });
    await app.mouse.up();
    await settle(app, 1200);
    const after = await read(app, (s) =>
      s.objects[0].paint?.supports ? Array.from(s.objects[0].paint.supports).filter(Boolean).length : 0,
    );
    expect(after).toBe(painted);
    expect(await column(app).then((c) => c.slice)).toBe(true);
  });

  test('a tool whose object is gone closes on its own (the guard, not an empty column)', async ({ app }) => {
    await click(app, '[data-testid="tool-cut"]', 800);
    expect(await read(app, (s) => s.activeTool)).toBe('cut');
    // what a delete, a merge or an undo does to the selection while the tool is open
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 500);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
    expect(await app.locator('[data-testid="tool-panel"]').count()).toBe(0);
    await expect(app.locator('[data-testid="slice-button"]')).toBeVisible();
  });
});
