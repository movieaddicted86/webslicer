/**
 * The recovery cards of the app's regions (P-7).
 *
 * A throw inside the viewer, the preview card or a dialog used to unmount the whole app: React 19 has
 * no implicit root boundary, so one broken render took the plater with it. Each region now sits in the
 * shared `ErrorBoundary` (`web/src/components/common/ErrorBoundary.tsx`): the card appears where the
 * region was, the rest of the app keeps working, and **Reload view** remounts the region.
 *
 * The throw is forced through the store, the app's public debug surface (`window.webslicer`) that the
 * suite already drives – no test-only hook in the build. `job.info.warnings` becomes a string there,
 * which the preview calls `.map` on: a real render error of the kind WebGL or a bad server answer
 * causes. The app's own reporters (the region boundary and `onUncaughtError`) log it, so the page has
 * one console error while the card is up; the spec checks that error is the app's, not a crash.
 *
 * The page is used directly instead of the `app` fixture: that fixture fails a test on any console
 * error, and this test *causes* one on purpose.
 */
import type { Page } from '@playwright/test';
import { CUBE, importFile, openApp, sliceAndWait } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { byId } from '../helpers/hooks';

/** Poison the job the preview renders: `warnings` is a string, so `.map` throws while rendering. */
const poisonJob = (page: Page) =>
  page.evaluate(() => {
    const s = window.webslicer.getState();
    const job = s.job;
    if (!job) return;
    // the store's type says `warnings` is a list; the point of the test is the server answer that is not
    const broken = { ...job, status: 'done', info: { ...job.info, warnings: 'not a list' } } as unknown as typeof job;
    window.webslicer.setState({ job: broken, view: 'preview' });
  });

test.describe('a throwing region is contained (P-7)', () => {
  test('the preview shows a recovery card, the shell survives and Reload view remounts it', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await openApp(page);
    await importFile(page, CUBE);
    await sliceAndWait(page);

    // the app is healthy before the break: the shell, the top bar and the preview are there
    await expect(byId(page, 'app-shell')).toBeVisible();
    await expect(byId(page, 'preview-panel')).toBeVisible();

    await poisonJob(page);

    // the card replaces the preview and names the region; the rest of the app keeps working
    const card = byId(page, 'error-fallback');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Something went wrong');
    await expect(card).toContainText('Preview');
    await expect(byId(page, 'app-shell')).toBeVisible();
    await expect(byId(page, 'top-bar')).toBeVisible();
    // the sibling regions of the failed card still work: the tool strip, the legend, the footer
    await expect(byId(page, 'left-column')).toBeVisible();
    await expect(byId(page, 'legend')).toBeVisible();
    await expect(byId(page, 'send-button')).toBeVisible();
    await expect(byId(page, 'preview-panel')).toHaveCount(0);

    // Reload view rebuilds the region: the poisoned job is still bad, so the card comes back at once
    // instead of a blank panel – the button is a real control either way
    await byId(page, 'error-retry').click();
    await expect(card).toBeVisible();

    // with a healthy job the retried region renders again
    await page.evaluate(() => {
      const s = window.webslicer.getState();
      const job = s.job;
      if (job) window.webslicer.setState({ job: { ...job, info: { ...job.info, warnings: [] } } });
    });
    await byId(page, 'error-retry').click();
    await expect(byId(page, 'preview-panel')).toBeVisible();

    // the app logged the error (its own message) and nothing else crashed the page
    expect(errors.some((e) => e.includes('[webslicer] UI error'))).toBe(true);
  });
});
