/**
 * The update notice (T-058): the server's answer to `GET /api/update-status` reaches the rail's About
 * item as a quiet chip and the About dialog as one row. Nothing appears when the install is current or
 * the check is switched off, and dismissing is remembered per `latest` value.
 *
 * The answer is mocked through route interception and applied with the store's own
 * `refreshUpdateStatus()`, so the spec exercises the same fetch → store → render path a real server
 * answer takes. The real E2E image is built with `GIT_COMMIT=unknown`, so its own answer is a silent
 * "up to date" and would not make the chip appear anyway.
 */
import { waitReady } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click, closeDialog, openDialog } from '../helpers/dom';
import type { Page } from '@playwright/test';

interface Answer {
  current: string;
  latest: string;
  behind: number;
  url: string;
  checkedAt: string | null;
  enabled: boolean;
  tag?: string;
}

const COMPARE = 'https://github.com/movieaddicted86/webslicer/compare/7ebbe07...main';

/** Answer `GET /api/update-status` with `answer` and let the store fetch it. */
async function answerWith(app: Page, answer: Answer): Promise<void> {
  await app.unroute('**/api/update-status');
  await app.route('**/api/update-status', (route) => route.fulfill({ json: answer }));
  await app.evaluate(() => window.webslicer.getState().refreshUpdateStatus());
  await app.waitForTimeout(700);
}

const upToDate: Answer = {
  current: '7ebbe07',
  latest: '7ebbe07',
  behind: 0,
  url: 'https://github.com/movieaddicted86/webslicer/commits/main',
  checkedAt: '2026-10-23T08:00:00.000Z',
  enabled: true,
};

test.describe('update notice: chip, About row and dismissal', () => {
  test('the chip and the About row show the distance, and a dismissal is remembered', async ({ app }) => {
    const behind: Answer = { ...upToDate, latest: 'aaa1111', behind: 3, url: COMPARE };
    await answerWith(app, behind);

    const chip = app.locator('.update-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('role', 'status');
    await expect(chip).toHaveAttribute('aria-label', 'Update available · 3 commits behind');
    const link = chip.locator('a');
    await expect(link).toHaveText('Update available · 3 commits behind');
    await expect(link).toHaveAttribute('href', COMPARE);
    await expect(link).toHaveAttribute('target', '_blank');

    // the same answer in the About dialog, next to the existing three rows
    await openDialog(app, 'about');
    const about = await app.evaluate(() => ({
      rows: Array.from(document.querySelectorAll('.kv tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent)),
      href: document.querySelector('.about-update a')?.getAttribute('href'),
    }));
    expect(about.rows).toHaveLength(4);
    expect(about.rows[3][0]).toBe('Update');
    expect(about.rows[3][1]).toContain('Update available · 3 commits behind');
    expect(about.rows[3][1]).toContain('checked');
    expect(about.href).toBe(COMPARE);
    await closeDialog(app, 'escape');

    // dismiss: the chip goes away and the `latest` is stored
    await click(app, '.update-chip-dismiss', 500);
    await expect(chip).toHaveCount(0);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.updateDismissed'))).toBe('aaa1111');

    // a reload reads the answer again, but the dismissal keeps the chip hidden
    await app.reload({ waitUntil: 'networkidle' });
    await waitReady(app);
    await expect(app.locator('.update-chip')).toHaveCount(0);
    expect(await app.evaluate(() => window.webslicer.getState().updateStatus?.latest)).toBe('aaa1111');

    // a newer commit is a new notice: the dismissal was for the old `latest` only
    await answerWith(app, { ...behind, latest: 'bbb2222', behind: 6 });
    await expect(app.locator('.update-chip a')).toHaveText('Update available · 6 commits behind');
  });

  test('a newer release tag names the release', async ({ app }) => {
    await answerWith(app, {
      ...upToDate,
      latest: 'ccc3333',
      tag: 'v1.1.0',
      behind: 12,
      url: 'https://github.com/movieaddicted86/webslicer/releases/tag/v1.1.0',
    });
    const chip = app.locator('.update-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('aria-label', 'Update available · v1.1.0');
    await expect(chip.locator('a')).toHaveAttribute('href', 'https://github.com/movieaddicted86/webslicer/releases/tag/v1.1.0');

    // the mobile layout keeps the chip inside the rail's bottom bar, and nothing overflows the window
    await app.setViewportSize({ width: 320, height: 640 });
    await app.waitForTimeout(500);
    const overflow = await app.evaluate(() => {
      const rail = document.querySelector('[data-testid="rail"]') as HTMLElement;
      const chip = document.querySelector('.update-chip') as HTMLElement;
      return {
        rail: rail.scrollWidth - rail.clientWidth,
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        chip: chip.getBoundingClientRect().right - window.innerWidth,
        height: Math.round(chip.getBoundingClientRect().height),
      };
    });
    expect(overflow.rail).toBeLessThanOrEqual(0);
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.chip).toBeLessThanOrEqual(0);
    // one compact badge, not a wrapped block
    expect(overflow.height).toBeLessThan(40);
  });

  test('nothing appears when the install is current or the check is off', async ({ app }) => {
    await answerWith(app, upToDate);
    await expect(app.locator('.update-chip')).toHaveCount(0);
    await openDialog(app, 'about');
    expect(await app.locator('.kv tr').count()).toBe(3);
    await closeDialog(app, 'escape');

    // `WEBSLICER_UPDATE_CHECK=off`: the server still answers, but with `enabled: false`
    await answerWith(app, { ...upToDate, latest: 'ddd4444', behind: 9, enabled: false });
    await expect(app.locator('.update-chip')).toHaveCount(0);
    await openDialog(app, 'about');
    expect(await app.locator('.kv tr').count()).toBe(3);

    // and no update notice was written by the previous answers either
    expect(await app.evaluate(() => localStorage.getItem('webslicer.updateDismissed'))).toBeNull();
  });
});
