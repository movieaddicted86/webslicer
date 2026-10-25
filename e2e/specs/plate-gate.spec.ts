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
import { CUBE, importFile, read, settle, sliceAndWait, waitNewJob, waitSliceDone } from '../helpers/app';
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
