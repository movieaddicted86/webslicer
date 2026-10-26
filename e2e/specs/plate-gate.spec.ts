/**
 * The plate and limit checks hold on every path into a slice, the Preview included (T-073).
 *
 * The checks used to live in the Prepare footer alone: a plate whose skirt ran over the bed edge
 * disabled "Slice now" there, and the Preview then sliced the same plate anyway. The store action is
 * the seam now, so the Preview's own button, the re-slice after a colour change and a scripted call
 * are refused with the same reasons – and a finished result whose plate no longer passes the checks
 * cannot leave the app through Send, Export or Save.
 *
 * Both acceptance criteria of the task are driven through the UI: the block in both views with the
 * reasons visible (AC-1), and the slice working again once the cause is gone (AC-2).
 *
 * T-075 / Z-06: a finished result whose plate now fails the checks is shown as **outdated** – the
 * toolpaths lose their colours (one grey, low opacity) and the Preview opens with the "outdated" banner
 * above the blocker list, so the old result cannot read as the print that would come out. Fixing the
 * plate brings the colours back without a new slice.
 */
import { CUBE, L_BRACKET, importFile, read, settle, sliceAndWait, waitNewJob, waitSliceDone } from '../helpers/app';
import { gcodeLook } from '../helpers/canvas';
import { expect, test } from '../helpers/fixtures';

/** The cube at the left bed edge: it fits, but the default 1-loop skirt (5 mm out) leaves the bed. */
const AT_THE_EDGE = 10;
/** The middle of the fixture bed: the skirt fits. */
const IN_THE_MIDDLE = 125;
/** The reason the checks give for the plate at the edge, in the wording of the shared plate rules. */
const SKIRT = /1-loop skirt 5 mm from the objects runs outside the print volume/;

/** The presets of the case: one skirt loop 5 mm from the objects, and no brim to muddy the reason. */
async function skirtPresets(app: Parameters<typeof importFile>[0]): Promise<void> {
  await app.evaluate(() => {
    const s = window.webslicer.getState();
    s.setOption('print', 'skirts', '1');
    s.setOption('print', 'skirt_distance', '5');
    s.setOption('print', 'brim_type', 'none');
  });
}

/** Move the single instance of the first object to `x` on the fixture bed. */
async function moveTo(app: Parameters<typeof importFile>[0], x: number): Promise<void> {
  await app.evaluate((px) => {
    const s = window.webslicer.getState();
    const o = s.objects[0];
    s.updateInstance(o.id, o.instances[0].id, { position: [px, 105, 0] });
  }, x);
  await settle(app, 800);
}

test.describe('the plate checks hold in the Preview too (T-073)', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await skirtPresets(app);
    await settle(app, 700);
  });

  test('a blocked plate starts no slice from the Preview and lists the reason there (AC-1, AC-2)', async ({ app }) => {
    await moveTo(app, AT_THE_EDGE);

    // Prepare: the known T-034 gate, disabled with the skirt reason
    const prepareSlice = app.locator('[data-testid="slice-button"]');
    await expect(prepareSlice).toBeDisabled();
    await expect(prepareSlice).toHaveAttribute('title', SKIRT);

    // Preview: the same reason, the button disabled with the same tooltip – and no result at all
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 600);
    const previewSlice = app.locator('[data-testid="preview-slice-button"]');
    const blockers = app.locator('[data-testid="preview-blockers"] li');
    await expect(previewSlice).toBeDisabled();
    await expect(previewSlice).toHaveAttribute('title', SKIRT);
    await expect(blockers).toHaveCount(1);
    await expect(blockers.first()).toHaveText(SKIRT);
    expect(await read(app, (s) => s.job)).toBeUndefined();

    // the store itself refuses too – it is the seam behind every trigger, a scripted call included …
    await app.evaluate(() => window.webslicer.getState().slice());
    await settle(app, 800);
    expect(await read(app, (s) => s.job)).toBeUndefined();
    expect(await read(app, (s) => s.toasts.filter((t) => t.kind === 'error').map((t) => t.text))).toEqual([expect.stringMatching(SKIRT)]);

    // … and the re-slice after a colour change (the 900 ms timer) does not sneak past it either
    await app.evaluate(() => window.webslicer.getState().addCustomGcode({ printZ: 1, type: 'pause', extra: 'check' }));
    await settle(app, 1600);
    expect(await read(app, (s) => s.job)).toBeUndefined();

    // AC-2: back in the middle the plate passes, both buttons enable again and the slice runs
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);
    await moveTo(app, IN_THE_MIDDLE);
    await expect(prepareSlice).toBeEnabled();
    await expect(app.locator('[data-testid="slice-panel"] .plate-issues li')).toHaveCount(0);

    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 600);
    await expect(app.locator('[data-testid="preview-blockers"]')).toHaveCount(0);
    await expect(previewSlice).toBeEnabled();
    await previewSlice.click();
    await waitSliceDone(app, undefined);
    expect(await read(app, (s) => s.job?.status)).toBe('done');

    // … and the re-slice the app schedules itself works again as well
    const before = await read(app, (s) => s.job?.id);
    await app.evaluate(() => window.webslicer.getState().addCustomGcode({ printZ: 2, type: 'pause', extra: 'again' }));
    await waitNewJob(app, before);
    expect(await read(app, (s) => s.job?.status)).toBe('done');
  });

  test('a finished result whose plate fails the checks cannot be exported, saved or sent (AC-1 addendum)', async ({ app }) => {
    await moveTo(app, IN_THE_MIDDLE);
    await sliceAndWait(app);
    const jobId = await read(app, (s) => s.job?.id ?? '');
    expect(jobId).not.toBe('');

    // a finished result: the export is a link to its G-code
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 600);
    const exportAction = app.locator('[data-testid="export-gcode"]');
    const saveAction = app.locator('[data-testid="save-gcode"]');
    const send = app.locator('[data-testid="send-button"]');
    await expect(exportAction).toHaveAttribute('href', `/api/jobs/${jobId}/gcode?download`);

    // move the object to the edge: the result stays readable, but it belongs to a plate that now fails
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);
    await moveTo(app, AT_THE_EDGE);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 700);

    expect(await read(app, (s) => s.job?.status)).toBe('done');
    await expect(app.locator('[data-testid="preview-blockers"] li').first()).toHaveText(SKIRT);
    await expect(exportAction).toBeDisabled();
    await expect(exportAction).not.toHaveAttribute('href');
    await expect(exportAction).toHaveAttribute('title', SKIRT);
    await expect(saveAction).toBeDisabled();
    await expect(saveAction).toHaveAttribute('title', SKIRT);
    // no host is configured in the fixture, so the plate reason is the tooltip that can be asserted
    await expect(send).toBeDisabled();
    await expect(send).toHaveAttribute('title', SKIRT);

    // the cause gone: the finished result is exportable again, without a new slice
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);
    await moveTo(app, IN_THE_MIDDLE);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 700);
    await expect(app.locator('[data-testid="preview-blockers"]')).toHaveCount(0);
    await expect(exportAction).toHaveAttribute('href', `/api/jobs/${jobId}/gcode?download`);
    await expect(saveAction).toBeEnabled();
    expect(await read(app, (s) => s.job?.id)).toBe(jobId);
  });

  test('a result whose plate fails the checks is greyed out and says it is outdated (Z-06)', async ({ app }) => {
    await moveTo(app, IN_THE_MIDDLE);
    await sliceAndWait(app);
    const jobId = await read(app, (s) => s.job?.id ?? '');
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 900);

    // a current result: coloured toolpaths (one colour per feature), no banner, no blockers
    const current = await gcodeLook(app);
    expect(current, 'the toolpaths are in the scene').not.toBeNull();
    expect(current!.colours, 'a current result carries the feature colours').toBeGreaterThan(1);
    expect(current!.opacity).toBe(1);
    await expect(app.locator('[data-testid="preview-outdated"]')).toHaveCount(0);
    await expect(app.locator('[data-testid="preview-panel"]')).not.toHaveAttribute('data-outdated', 'true');

    // the plate fails: the result stays, greyed out, with the banner and the reason
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);
    await moveTo(app, AT_THE_EDGE);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 900);

    expect(await read(app, (s) => s.job?.id), 'the result itself is kept').toBe(jobId);
    await expect(app.locator('[data-testid="preview-panel"]')).toHaveAttribute('data-outdated', 'true');
    const banner = app.locator('[data-testid="preview-outdated"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('This result is outdated – the plate does not pass the checks');
    await expect(banner.locator('[data-testid="preview-blockers"] li')).toHaveCount(1);
    await expect(banner.locator('[data-testid="preview-blockers"] li').first()).toHaveText(SKIRT);
    // the plain "slice again" note would be a different statement – a blocked plate cannot be re-sliced
    await expect(app.locator('[data-testid="preview-panel"] .warn')).toHaveCount(0);

    const grey = await gcodeLook(app);
    expect(grey, 'the greyed toolpaths are still drawn').not.toBeNull();
    expect(grey!.colours, 'the outdated result shows one grey, no layer colours').toBe(1);
    expect(grey!.opacity, 'the outdated result is faded').toBeLessThan(0.5);

    // the plate passes again: the colours return without a new slice
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 500);
    await moveTo(app, IN_THE_MIDDLE);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 900);

    expect(await read(app, (s) => s.job?.id), 'still the same result').toBe(jobId);
    await expect(app.locator('[data-testid="preview-outdated"]')).toHaveCount(0);
    await expect(app.locator('[data-testid="preview-panel"]')).not.toHaveAttribute('data-outdated', 'true');
    const back = await gcodeLook(app);
    expect(back!.colours, 'the feature colours are back').toBeGreaterThan(1);
    expect(back!.opacity).toBe(1);
  });
});

/** Put the first instance of an object at `position`, turned `rotationZ` radians about Z. */
async function place(
  app: Parameters<typeof importFile>[0],
  objectId: string,
  position: [number, number, number],
  rotationZ = 0,
): Promise<void> {
  await app.evaluate(
    ({ id, position, rotationZ }) => {
      const s = window.webslicer.getState();
      const o = s.objects.find((x) => x.id === id);
      if (o) s.updateInstance(o.id, o.instances[0].id, { position, rotation: [0, 0, rotationZ] });
    },
    { id: objectId, position, rotationZ },
  );
  await settle(app, 800);
}

test.describe('the plate check measures the real outline (T-078)', () => {
  test('two L parts that interlock with a gap are not blocked, a true overlap still is', async ({ app }) => {
    // two L brackets: a 40 × 40 mm square with a 25 × 25 mm notch cut at the top right
    await importFile(app, L_BRACKET);
    await importFile(app, L_BRACKET, { clear: false });
    await skirtPresets(app);
    const [first, second] = await read(app, (s) => s.objects.map((o) => o.id));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    // the second L turned 180°, its notch facing the first one: the 40 mm boxes overlap by 7 mm,
    // the outlines leave 2.1 mm along the diagonal
    await place(app, first!, [100, 105, 0]);
    await place(app, second!, [100, 138, 0], Math.PI);
    const boxesOverlap = await read(app, (s) => {
      const [a, b] = s.objects;
      const dy = Math.abs(a.instances[0].position[1] - b.instances[0].position[1]);
      return a.size[1] - dy;
    });
    expect(boxesOverlap, 'the bounding boxes overlap where the outlines do not').toBeGreaterThan(0);
    await expect(app.locator('[data-testid="slice-button"]')).toBeEnabled();
    await expect(app.locator('[data-testid="slice-panel"] .plate-issues li')).toHaveCount(0);

    // 8 mm closer: the diagonal edges cut into each other, past the toolpath-conflict limit
    await place(app, second!, [100, 130, 0], Math.PI);
    const slice = app.locator('[data-testid="slice-button"]');
    await expect(slice).toBeDisabled();
    await expect(slice).toHaveAttribute('title', /G-code path conflict/);
    await expect(app.locator('[data-testid="slice-panel"] .plate-issues li')).toHaveCount(1);

    // apart again: the plate passes without another change
    await place(app, second!, [100, 138, 0], Math.PI);
    await expect(slice).toBeEnabled();
    await expect(app.locator('[data-testid="slice-panel"] .plate-issues li')).toHaveCount(0);
  });
});
