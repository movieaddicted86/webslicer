/**
 * T-009: STEP import in the browser.
 *
 * The browser cannot read STEP, so the file goes to `POST /api/convert/step` and the converted binary
 * STL takes the normal import path. AC-1 imports the 20 mm STEP cube from the samples (seeded into the
 * library) and checks its size in the plater and that it slices; AC-2 imports a broken STEP and expects
 * a clear toast and no object – the request must end, not hang.
 */
import { BROKEN_STEP, STEP_CUBE, read, sliceAndWait, state, waitUploads } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/** The toasts the store currently shows, as `kind:text`. */
const toasts = (app: Parameters<typeof state>[0]) => read(app, (s) => s.toasts.map((t) => `${t.kind}:${t.text}`));

test.describe('STEP import', () => {
  test('a STEP file imports with the right size and slices', async ({ app }) => {
    await app.evaluate(() => {
      const st = window.webslicer.getState();
      st.clearObjects();
      // a broken import of an earlier spec must not pass for this one's error toast
      for (const t of st.toasts) st.dismissToast(t.id);
    });
    await app.locator('input[type="file"]').first().setInputFiles(STEP_CUBE);
    await waitUploads(app);
    await app.waitForTimeout(1200);

    const s = await state(app);
    expect(s.objects).toHaveLength(1);
    expect(s.objects[0].name).toBe('calibration_cube_20mm');
    expect(s.objects[0].modelId, 'the converted model was uploaded').toBeTruthy();
    // the STEP cube is 20 × 20 × 20 mm – the CLI export keeps the millimetre size (±0.01)
    for (const edge of s.objects[0].size) expect(Math.abs(edge - 20)).toBeLessThan(0.01);

    await sliceAndWait(app);
    expect((await state(app)).job?.status).toBe('done');
  });

  test('a broken STEP gives a clear error toast and adds no object', async ({ app }) => {
    await app.evaluate(() => {
      const st = window.webslicer.getState();
      st.clearObjects();
      for (const t of st.toasts) st.dismissToast(t.id);
    });
    await app.locator('input[type="file"]').first().setInputFiles(BROKEN_STEP);
    // the rejection arrives as a toast; a hanging request would time the wait out
    await app.waitForFunction(() => window.webslicer.getState().toasts.some((t) => t.kind === 'error'), null, { timeout: 60_000 });

    const messages = await toasts(app);
    expect(messages.join(' | ')).toMatch(/error:.*broken\.step/i);
    expect((await state(app)).objects).toHaveLength(0);
  });
});
