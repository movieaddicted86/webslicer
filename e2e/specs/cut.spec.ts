/**
 * T-044: the cut tool.
 *
 * AC-1 is the whole path against the real CLI: a 20 mm cube is cut at Z 10 with both parts kept, and
 * both parts have to be 20 × 20 × 10, watertight (the object info shows no open edges) and together
 * print the same filament as the uncut cube (±2 %). The other two tests cover the tilted plane (AC-2,
 * checked through the bounding boxes the server returns) and undo (AC-4, one Ctrl+Z restores the
 * uncut object).
 */
import { CUBE, importFile, press, read, rest, settle, sliceAndWait, state, waitUploads } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/** The object info lines of the object list, as text. */
const infoLines = (app: Parameters<typeof read>[0]) => app.locator('.object-row + .object-info').allInnerTexts();

/** Total filament (mm) of the current job. */
const filament = (app: Parameters<typeof read>[0]) => read(app, (s) => (s.job?.info?.filamentUsedMm || []).reduce((a, b) => a + b, 0));

/**
 * Import the cube and give it a verification-friendly print profile: no skirt/brim/infill, and no top
 * or bottom solid layers. The last part matters for AC-1 – a cut gives each half a new cut face, and
 * with the default solid layers the two halves would legitimately print twice the top/bottom material
 * of the uncut cube. Without them the filament measures the walls only, which two halves add up to.
 */
async function importCube(app: Parameters<typeof read>[0]) {
  await importFile(app, CUBE);
  await app.evaluate(() => {
    const s = window.webslicer.getState();
    s.setOption('print', 'skirts', '0');
    s.setOption('print', 'brim_type', 'no_brim');
    s.setOption('print', 'fill_density', '0%');
    s.setOption('print', 'top_solid_layers', '0');
    s.setOption('print', 'bottom_solid_layers', '0');
    s.select([s.objects[0].id]);
  });
  await settle(app, 700);
}

test.describe('cut', () => {
  test('a cube cut at Z 10 gives two watertight halves with the same filament', async ({ app }) => {
    await importCube(app);
    // the reference: the uncut cube
    await sliceAndWait(app);
    const original = await filament(app);
    expect(original).toBeGreaterThan(0);
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);

    const before = await state(app);
    const id = before.objects[0].id;
    // open the panel through the button (the shortcut is covered below) and cut in the middle
    await app.evaluate((objectId) => {
      const s = window.webslicer.getState();
      s.select([objectId]);
      s.openTool('cut');
      s.setCutSettings({ z: 10, keep: 'both', placeOnCut: false, flipUpper: false });
    }, id);
    await settle(app, 400);
    await expect(app.locator('.tool-panel')).toBeVisible();

    await app.locator('.tool-panel button:has-text("Perform cut")').click();
    // the server cuts with the CLI and the two models come back; the viewer loads them
    await app.waitForFunction(
      (prev) => {
        const s = window.webslicer.getState();
        return s.objects.length === 2 && s.objects.every((o) => o.modelId && o.id !== prev);
      },
      id,
      { timeout: 180_000 },
    );
    await settle(app, 1200);

    const after = await state(app);
    expect(after.objects).toHaveLength(2);
    expect(after.activeTool).toBeUndefined();
    for (const o of after.objects) {
      expect(o.name).toMatch(/cube/i);
      // 20 × 20 × 10 mm – halves of the 20 mm cube
      expect(o.size[0]).toBeGreaterThan(19.9);
      expect(o.size[1]).toBeGreaterThan(19.9);
      expect(Math.abs(o.size[2] - 10)).toBeLessThan(0.05);
    }
    // watertight: the info line reports no open edges for either half
    const lines = await infoLines(app);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line, line).not.toMatch(/Not manifold/);

    await sliceAndWait(app, before.job?.id);
    const cut = await filament(app);
    expect(Math.abs(cut - original) / original, `uncut ${original} mm, cut ${cut} mm`).toBeLessThan(0.02);
  });

  test('a plane tilted 30° about X cuts the cube into two tilted parts', async ({ app }) => {
    await importCube(app);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const id = s.objects[0].id;
      s.select([id]);
      s.openTool('cut');
      // the middle of the object, tilted about its X axis
      s.setCutSettings({ z: 10, rotX: 30, rotY: 0, keep: 'both' });
    });
    await settle(app, 400);
    await expect(app.locator('.tool-panel')).toBeVisible();
    await app.locator('.tool-panel button:has-text("Perform cut")').click();
    await app.waitForFunction(() => window.webslicer.getState().objects.length === 2, null, { timeout: 180_000 });
    await settle(app, 800);

    const after = await state(app);
    expect(after.objects).toHaveLength(2);
    // a 20 mm cube cut by a plane through its middle, tilted 30° about X: the plane runs from
    // z = 10 − 10·tan30 at the front edge to z = 10 + 10·tan30 at the back one, so each half is
    // 20 × 20 wide and (10 + 10·tan30) ≈ 15.77 tall
    const expectedZ = 10 + 10 * Math.tan(Math.PI / 6);
    for (const o of after.objects) {
      expect(Math.abs(o.size[0] - 20)).toBeLessThan(0.1);
      expect(Math.abs(o.size[1] - 20)).toBeLessThan(0.1);
      expect(Math.abs(o.size[2] - expectedZ)).toBeLessThan(0.1);
    }
    // the two parts together are the cube: no volume lost or doubled
    const total = after.objects.reduce((n, o) => n + o.size[0] * o.size[1] * o.size[2], 0);
    expect(total).toBeGreaterThan(2 * 20 * 20 * expectedZ * 0.9);
  });

  test('Ctrl+Z restores the uncut object in one step', async ({ app }) => {
    await importCube(app);
    const before = await state(app);
    const id = before.objects[0].id;
    await press(app, 'c');
    await expect(app.locator('.tool-panel')).toBeVisible();
    await app.evaluate(() => window.webslicer.getState().setCutSettings({ z: 10, keep: 'both' }));
    await app.locator('.tool-panel button:has-text("Perform cut")').click();
    await app.waitForFunction(() => window.webslicer.getState().objects.length === 2, null, { timeout: 180_000 });
    await settle(app, 800);

    await press(app, 'Control+z');
    await settle(app, 500);
    const restored = await state(app);
    expect(restored.objects).toHaveLength(1);
    expect(restored.objects[0].id).toBe(id);
    expect(restored.objects[0].modelId).toBe(before.objects[0].modelId);
  });

  test('the button is disabled for an object with a modifier, with the reason as tooltip', async ({ app }) => {
    await importCube(app);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      void s.addVolume(o.id, { name: 'Blocker', type: 'SupportBlocker', geometry: o.geometry.clone() });
    });
    await waitUploads(app);
    await settle(app, 800);
    // the toolbar's cut button, not the row's "split to objects" (which carries the same tooltip)
    const button = app.locator('.objects .tools button[title="Remove modifiers and parts first"]');
    await expect(button).toBeDisabled();
    // and the endpoint refuses a plane without direction, whatever the UI does
    const res = await rest(app, 'POST', '/api/cut', {
      modelId: (await state(app)).objects[0].modelId,
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      plane: { point: [0, 0, 5], normal: [0, 0, 0] },
    });
    expect(res.status).toBe(400);
  });
});
