/**
 * T-035: the last session comes back on its own.
 *
 * A reload (and a browser restart, which is the same reload with a fresh page) restores the plater
 * without a click; "Start empty" on the notice keeps it empty; and a change made just before a
 * reload survives because the page flushes its pending autosave on `pagehide`.
 *
 * Every test gets a fresh browser context, so `clientId` and the autosave slot are per test.
 */
import { CUBE, importFile, read, state, waitReady } from '../helpers/app';
import { settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import type { Page } from '@playwright/test';
/** Wait until the app restored a plater after a reload (the restore is asynchronous). */
async function waitRestored(app: Page): Promise<void> {
  await app.waitForFunction(() => window.webslicer.getState().objects.length > 0, null, { timeout: 60_000 });
  await app.waitForTimeout(1500);
}

/** Wait until the debounced autosave finished, so a reload tests the normal path. */
async function waitAutosaved(app: Page): Promise<void> {
  await app.waitForFunction(() => window.webslicer.getState().autosaveState === 'saved', null, { timeout: 60_000 });
}

/** The first instance moved off the bed centre and some triangles painted as support enforcers. */
async function moveAndPaint(app: Page): Promise<void> {
  const id = await read(app, (s) => s.objects[0].id);
  const instanceId = await read(app, (s) => s.objects[0].instances[0].id);
  await app.evaluate(
    ([objectId, instId]) =>
      window.webslicer.getState().updateInstance(objectId as string, instId as string, { position: [40, 30, 0], rotation: [0, 0, 0.5] }),
    [id, instanceId] as const,
  );
  await app.evaluate(async (objectId) => {
    const s = window.webslicer.getState();
    await s.startPaint(objectId, 'supports');
    const st = window.webslicer.getState();
    st.beginPaintStroke(objectId);
    st.applyPaint(objectId, 'supports', [0, 1, 2, 3, 4, 5], 1);
    st.stopPaint();
  }, id);
  // startPaint re-uploads the subdivided mesh; the autosave needs that model id
  await app.waitForFunction(() => window.webslicer.getState().objects.every((o) => o.modelId || o.uploadError), null, { timeout: 180_000 });
}

/** The painted triangle count, evaluated in the page (a typed array does not cross the boundary). */
async function paintedTriangles(app: Page): Promise<number> {
  return app.evaluate(() => {
    const paint = window.webslicer.getState().objects[0]?.paint?.supports;
    return paint ? Array.from(paint).filter(Boolean).length : 0;
  });
}

/** Wait until the autosave slot of this browser is gone (the DELETE of "Start empty" landed). */
async function waitNoAutosave(app: Page): Promise<void> {
  await app.waitForFunction(
    async () => {
      const id = localStorage.getItem('webslicer.clientId');
      if (!id) return true;
      const res = await fetch(`/api/autosave/${id}?info`);
      return res.status === 404;
    },
    null,
    { timeout: 30_000 },
  );
}

test.describe('session: reload restores the plater (T-035)', () => {
  test('a reload brings objects, positions and paint back without a click', async ({ app }) => {
    await importFile(app, CUBE);
    await moveAndPaint(app);
    await waitAutosaved(app);
    await settle(app);

    const before = await state(app);
    const painted = await paintedTriangles(app);
    expect(painted).toBeGreaterThan(0);

    await app.reload();
    await waitReady(app);
    await waitRestored(app);

    const after = await state(app);
    expect(after.objects).toHaveLength(1);
    expect(after.objects[0].name).toBe(before.objects[0].name);
    const position = after.objects[0].instances[0].position;
    position.forEach((v, i) => expect(Math.abs(v - before.objects[0].instances[0].position[i])).toBeLessThan(1e-6));
    const rotation = after.objects[0].instances[0].rotation;
    rotation.forEach((v, i) => expect(Math.abs(v - before.objects[0].instances[0].rotation[i])).toBeLessThan(1e-6));
    expect(await paintedTriangles(app)).toBe(painted);
    // the automatic restore says so, and offers to start over
    await expect(app.locator('.toast', { hasText: 'Previous session restored' })).toBeVisible();
    await expect(app.locator('.toast-action', { hasText: 'Start empty' })).toBeVisible();
  });

  test('a change made less than 2 s before the reload is not lost (pagehide flush)', async ({ app }) => {
    await importFile(app, CUBE);
    await waitAutosaved(app);
    await settle(app);

    const id = await read(app, (s) => s.objects[0].id);
    const instanceId = await read(app, (s) => s.objects[0].instances[0].id);
    await app.evaluate(
      ([objectId, instId]) => window.webslicer.getState().updateInstance(objectId as string, instId as string, { position: [70, 60, 0] }),
      [id, instanceId] as const,
    );
    // well inside the 8 s autosave debounce: only the flush on the way out can save this
    await app.reload();
    await waitReady(app);
    await waitRestored(app);

    const pos = await read(app, (s) => s.objects[0].instances[0].position);
    expect(pos[0]).toBeCloseTo(70, 3);
    expect(pos[1]).toBeCloseTo(60, 3);
  });

  test('"Start empty" keeps the plater empty across the next reload', async ({ app }) => {
    await importFile(app, CUBE);
    await waitAutosaved(app);
    await settle(app);

    await app.reload();
    await waitReady(app);
    await waitRestored(app);

    await app.locator('.toast-action', { hasText: 'Start empty' }).click();
    expect(await read(app, (s) => s.objects.length)).toBe(0);
    await waitNoAutosave(app);

    await app.reload();
    await waitReady(app);
    await app.waitForTimeout(3000);
    expect(await read(app, (s) => s.objects.length)).toBe(0);
    await expect(app.locator('.toast', { hasText: 'Previous session restored' })).toHaveCount(0);
  });
});
