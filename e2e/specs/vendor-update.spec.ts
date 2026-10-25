/**
 * Vendor profile updates in the Printers dialog: the summary line, the rows that matter, "Show all
 * vendors", one click to install, and a refused bundle that shows why it was refused.
 *
 * Both answers are intercepted, so the spec never talks to the profile repository and needs no bundle
 * on disk: it exercises the section's fetch → render → click path and the report the user reads.
 */
import { expect, test } from '../helpers/fixtures';
import { closeDialog, openDialog } from '../helpers/dom';
import type { Page } from '@playwright/test';
import type { VendorUpdate, VendorUpdateList, VendorUpdateResult } from '@webslicer/shared';

const CHECKED = '2026-10-24T08:00:00.000Z';

/** One vendor row of the check's answer; everything is opt-in except the identity. */
const vendor = (over: Partial<VendorUpdate> = {}): VendorUpdate => ({
  id: 'PrusaResearch',
  name: 'Prusa Research',
  installed: '2.4.14',
  available: '2.4.15',
  compatible: true,
  update: true,
  url: 'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/PrusaResearch',
  canRevert: false,
  checkedAt: CHECKED,
  ...over,
});

const list = (over: Partial<VendorUpdateList> = {}): VendorUpdateList => ({
  enabled: true,
  checkedAt: CHECKED,
  vendors: [vendor()],
  ...over,
});

const installed = (over: Partial<VendorUpdateResult> = {}): VendorUpdateResult => ({
  vendor: 'PrusaResearch',
  from: '2.4.14',
  to: '2.4.15',
  orphaned: [],
  ...over,
});

/** Answer the check and the install route; `install` may also be a raw answer. */
async function mockRoutes(
  app: Page,
  updates: VendorUpdateList,
  install: VendorUpdateResult | { status: number; json: object },
): Promise<void> {
  await app.route('**/api/vendors/updates*', (route) => route.fulfill({ json: updates }));
  await app.route('**/api/vendors/*/update', (route) => ('status' in install ? route.fulfill(install) : route.fulfill({ json: install })));
}

/** The section as the dialog renders it. */
const section = (app: Page) =>
  app.evaluate(() => {
    const root = document.querySelector('.vendor-updates');
    const rows = Array.from(document.querySelectorAll('.vendor-update-list li'));
    return {
      present: !!root,
      label: root?.getAttribute('aria-label'),
      disabled: document.querySelector('.vendor-updates-head')?.textContent?.includes('Online updates are disabled') ?? false,
      summary: document.querySelector('[data-testid="vendor-updates-summary"]')?.textContent?.trim(),
      head: Array.from(document.querySelectorAll('.vendor-updates-head button')).map((b) => b.textContent),
      toggle: document.querySelector('.vendor-updates-all')?.textContent?.trim(),
      names: rows.map((r) => r.querySelector('.name')?.textContent),
      versions: rows.map((r) => r.querySelector('.versions')?.textContent?.trim().replace(/\s+/g, ' ')),
      buttons: rows.map((r) => Array.from(r.querySelectorAll('button')).map((b) => b.textContent)),
      links: Array.from(document.querySelectorAll('.vendor-update-list a')).length,
      source: !!document.querySelector('.vendor-updates a[href*="PrusaSlicer-settings"]'),
      result: document.querySelector('.vendor-updates .success, .vendor-updates .error')?.textContent ?? '',
      refusals: Array.from(document.querySelectorAll('.vendor-updates .refusals li')).map((li) => li.textContent ?? ''),
      fileInput: !!document.querySelector('.vendor-updates input[type="file"]'),
    };
  });

test.describe('vendor profile updates', () => {
  test('an offered update is installed with one click and reported', async ({ app }) => {
    await mockRoutes(app, list(), installed());
    await openDialog(app, 'printers', { tab: 'vendor' });

    await expect(app.locator('.vendor-updates')).toHaveCount(1);
    await expect(app.locator('.vendor-update-list li')).toHaveCount(1);
    const before = await section(app);
    expect(before.label).toBe('Vendor profile updates');
    expect(before.summary).toBe('1 vendor has an update');
    expect(before.versions[0]).toContain('installed 2.4.14');
    expect(before.versions[0]).toContain('update 2.4.15');
    expect(before.head).toContain('Update all (1)');
    expect(before.buttons[0]).toEqual(['Update']);
    // one source link for the whole section, none on the row
    expect(before.links).toBe(0);
    expect(before.source).toBe(true);

    await app.locator('.vendor-update-list li button:text-is("Update")').click();
    await expect(app.locator('.vendor-updates .success')).toContainText('Updated PrusaResearch 2.4.14 → 2.4.15');
    await closeDialog(app, 'escape');
  });

  test('everything current is one summary line and no list; "Show all vendors" lists every vendor', async ({ app }) => {
    await mockRoutes(
      app,
      list({
        vendors: [
          vendor({ id: 'Current', name: 'Current Vendor', available: '2.4.14', update: false, reason: 'up to date' }),
          // a lower remote version must not read as a downgrade arrow
          vendor({ id: 'Lower', name: 'Lower Vendor', available: '0.1.0', update: false, reason: 'up to date' }),
          // a pre-release is never offered as an update
          vendor({ id: 'Pre', name: 'Pre-release Vendor', available: '2.5.0-alpha1', update: false }),
        ],
      }),
      installed(),
    );
    await openDialog(app, 'printers', { tab: 'vendor' });

    await expect(app.locator('[data-testid="vendor-updates-summary"]')).toHaveText('All vendor profiles are up to date');
    await expect(app.locator('.vendor-update-list li')).toHaveCount(0);
    expect((await section(app)).toggle).toBe('Show all vendors (3 more)');

    await app.locator('.vendor-updates-all').click();
    await expect(app.locator('.vendor-update-list li')).toHaveCount(3);
    const all = await section(app);
    expect(all.names).toEqual(['Current Vendor', 'Lower Vendor', 'Pre-release Vendor']);
    // no arrow anywhere, and the pre-release is labelled
    expect(all.versions.join(' ')).not.toContain('→');
    expect(all.versions[1]).toBe('installed 2.4.14');
    expect(all.versions[2]).toContain('2.5.0-alpha1 (pre-release)');
    expect((await section(app)).toggle).toBe('Show fewer vendors');
    await closeDialog(app, 'escape');
  });

  test('at a narrow window nothing is clipped and the summary stays visible', async ({ app: page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await mockRoutes(
      page,
      list({
        vendors: [
          vendor({ id: 'Long', name: 'A vendor with a really long display name that must wrap', available: '2.4.15' }),
          vendor({ id: 'Current', name: 'Current Vendor', available: '2.4.14', update: false, reason: 'up to date' }),
        ],
      }),
      installed(),
    );
    await openDialog(page, 'printers', { tab: 'vendor' });
    await expect(page.locator('.vendor-update-list li')).toHaveCount(1);

    const overflow = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.vendor-update-list li'));
      const section = document.querySelector('.vendor-updates');
      const summary = document.querySelector('[data-testid="vendor-updates-summary"]');
      return {
        rows: rows.map((r) => r.scrollWidth - r.clientWidth),
        section: section ? section.scrollWidth - section.clientWidth : -1,
        summaryVisible: !!summary && summary.getBoundingClientRect().bottom <= window.innerHeight,
      };
    });
    expect(overflow.rows.every((d) => d <= 1)).toBe(true);
    expect(overflow.section).toBeLessThanOrEqual(1);
    expect(overflow.summaryVisible).toBe(true);
    await closeDialog(page, 'escape');
  });

  test('a refused bundle shows the findings and changes nothing', async ({ app }) => {
    await mockRoutes(app, list(), {
      status: 409,
      json: {
        error: 'the bundle PrusaResearch 2.4.15 was refused: 1 blocking finding(s)',
        refusals: [
          {
            type: 'filament',
            preset: 'Bad Filament',
            rule: 'config.hotend_limit',
            message: 'temperature is above the hotend limit',
          },
        ],
      },
    });
    await openDialog(app, 'printers', { tab: 'vendor' });

    await app.locator('.vendor-update-list li button:text-is("Update")').click();
    await expect(app.locator('.vendor-updates .error')).toContainText('was refused');
    const after = await section(app);
    expect(after.refusals).toHaveLength(1);
    expect(after.refusals[0]).toContain('Bad Filament');
    expect(after.refusals[0]).toContain('config.hotend_limit');
    // the bundle is still the installed one
    expect(after.versions[0]).toContain('installed 2.4.14');
    await closeDialog(app, 'escape');
  });

  test('with the check switched off the section says so and offers a file instead', async ({ app }) => {
    await mockRoutes(app, list({ enabled: false, checkedAt: null }), installed());
    await openDialog(app, 'printers', { tab: 'vendor' });

    const off = await section(app);
    expect(off.disabled).toBe(true);
    expect(off.fileInput).toBe(true);
    expect(off.head).toEqual([]);
    expect(off.toggle).toBeUndefined();
    // the vendor/model lists still work, they come from the image
    expect(await app.locator('.vendor-list li').count()).toBeGreaterThan(1);
    await closeDialog(app, 'escape');
  });
});
