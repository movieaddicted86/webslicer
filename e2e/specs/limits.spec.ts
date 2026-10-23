/**
 * The configuration limits in the editor (S1-e): the checks the server runs before slicing are
 * visible while editing, so a typo shows at the field instead of as a 400 after "Slice now".
 *
 * Two acceptance criteria of the task, both driven through the settings UI:
 * - AC-1: a hotend temperature far outside the global window reddens the field, disables the slice
 *   button with a summary that names the field, and fixing the value re-enables it;
 * - AC-2: a value outside the material's soft range only warns (yellow field, badge in the sidebar)
 *   and the slice still runs – with the server's warning carried on the job, as before.
 */
import { CUBE, importFile, read, settle, sliceAndWait } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { fill } from '../helpers/dom';

/** Open the filament settings of the first extruder in Expert mode, with `temperature` in view. */
async function openTemperature(app: Parameters<typeof fill>[0], value: string): Promise<void> {
  await app.evaluate(() => {
    const s = window.webslicer.getState();
    s.setMode('expert');
    s.setView('filament');
  });
  await app.waitForTimeout(500);
  await fill(app, '.settings-side input.search', 'temperature', 700);
  const field = app.locator('#opt-temperature input').first();
  await field.fill(value);
  await field.press('Enter');
  // the limits are debounced (≤ 200 ms), so give the panel a moment to catch up
  await app.waitForTimeout(600);
}

test.describe('limits: configuration limits in the editor (S1-e)', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    // a PLA filament, so a value inside the global window can still leave the material's soft range
    await app.evaluate(() => window.webslicer.getState().setOption('filament', 'filament_type', 'PLA'));
    await settle(app, 600);
  });

  test('a hotend far outside the window reddens the field and blocks the slice until it is fixed', async ({ app }) => {
    const sliceButton = app.locator('.slice-panel button.primary.big');
    await expect(sliceButton).toBeEnabled();

    await openTemperature(app, '2150');

    // the field itself: red frame and a message naming the allowed window
    await expect(app.locator('#opt-temperature')).toHaveClass(/issue-block/);
    const message = app.locator('#opt-temperature .field-issue.block');
    await expect(message).toHaveCount(1);
    await expect(message).toContainText('150–450 °C (or 0)');
    await expect(message).toContainText('temperature');

    // the sidebar: the issue is listed and Slice is disabled with the reason as tooltip
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(600);
    await expect(sliceButton).toBeDisabled();
    await expect(sliceButton).toHaveAttribute('title', /temperature = 2150 °C/);
    const listed = app.locator('.slice-panel .plate-issues.limits li');
    await expect(listed).toHaveCount(1);
    await expect(listed.first()).toContainText('temperature');
    await expect(listed.first().locator('.badge-limit.block')).toHaveCount(1);

    // fixing the value re-enables the slice and removes the issue everywhere
    await openTemperature(app, '215');
    await expect(app.locator('#opt-temperature')).not.toHaveClass(/issue-block/);
    await expect(app.locator('#opt-temperature .field-issue')).toHaveCount(0);
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(600);
    await expect(sliceButton).toBeEnabled();
    await expect(app.locator('.slice-panel .plate-issues.limits li')).toHaveCount(0);
  });

  test('an unusual value for the material only warns, and the job carries the warning', async ({ app }) => {
    const sliceButton = app.locator('.slice-panel button.primary.big');
    await openTemperature(app, '265');

    // yellow field, a message with the usual window, and no block
    await expect(app.locator('#opt-temperature')).toHaveClass(/issue-warn/);
    const message = app.locator('#opt-temperature .field-issue.warn');
    await expect(message).toHaveCount(1);
    await expect(message).toContainText('unusual for PLA');
    await expect(message).toContainText('175–255 °C');

    // the sidebar shows the yellow badge and keeps Slice enabled
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(600);
    await expect(sliceButton).toBeEnabled();
    await expect(app.locator('.slice-panel .plate-issues.limits li .badge-limit.warn')).toHaveCount(1);
    await expect(app.locator('.slice-panel .plate-issues.limits li .badge-limit.block')).toHaveCount(0);

    // the slice runs and the server reports the same warning on the job (S1-d behaviour, unchanged)
    await sliceAndWait(app);
    const job = await read(app, (s) => s.job);
    expect(job?.status).toBe('done');
    expect(job?.configIssues?.length).toBe(1);
    expect(job?.configIssues?.[0].key).toBe('temperature');
  });

  test('clicking an issue opens the settings tab at the field (AC-1 shortcut)', async ({ app }) => {
    await openTemperature(app, '2150');
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(600);
    await app.locator('.slice-panel .plate-issues.limits button.link').first().click();
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.view)).toBe('filament');
    await expect(app.locator('#opt-temperature')).toBeVisible();
    // the field is the active element, so typing straight away fixes it
    expect(await app.evaluate(() => document.activeElement?.closest('#opt-temperature') !== null)).toBe(true);
  });
});
