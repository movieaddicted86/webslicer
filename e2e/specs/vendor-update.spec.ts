/**
 * Vendor profile updates in the Printers dialog: what upstream offers, one click to install, and a
 * refused bundle that shows why it was refused.
 *
 * Both answers are intercepted, so the spec never talks to the profile repository and needs no bundle
 * on disk: it exercises the section's fetch → render → click path and the report the user reads.
 */
import { expect, test } from '../helpers/fixtures';
import { closeDialog, openDialog } from '../helpers/dom';
import type { Page } from '@playwright/test';
import type { VendorUpdateList, VendorUpdateResult } from '@webslicer/shared';

const CHECKED = '2026-10-24T08:00:00.000Z';

const list = (over: Partial<VendorUpdateList> = {}): VendorUpdateList => ({
  enabled: true,
  checkedAt: CHECKED,
  vendors: [
    {
      id: 'PrusaResearch',
      name: 'Prusa Research',
      installed: '2.4.14',
      available: '2.4.15',
      compatible: true,
      update: true,
      url: 'https://github.com/prusa3d/PrusaSlicer-settings/tree/master/live/PrusaResearch',
      canRevert: false,
      checkedAt: CHECKED,
    },
  ],
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
      head: Array.from(document.querySelectorAll('.vendor-updates-head button')).map((b) => b.textContent),
      versions: rows.map((r) => r.querySelector('.versions')?.textContent?.trim()),
      buttons: rows.map((r) => Array.from(r.querySelectorAll('button')).map((b) => b.textContent)),
      result: document.querySelector('.vendor-updates .success, .vendor-updates .error')?.textContent ?? '',
      refusals: Array.from(document.querySelectorAll('.vendor-updates .refusals li')).map((li) => li.textContent ?? ''),
      fileInput: !!document.querySelector('.vendor-updates input[type="file"]'),
    };
  });

test.describe('vendor profile updates', () => {
  test('an offered update is installed with one click and reported', async ({ app }) => {
    await mockRoutes(app, list(), installed());
    await openDialog(app, 'addPrinter');

    await expect(app.locator('.vendor-updates')).toHaveCount(1);
    await expect(app.locator('.vendor-update-list li')).toHaveCount(1);
    const before = await section(app);
    expect(before.label).toBe('Vendor profile updates');
    expect(before.versions[0]).toContain('2.4.14 → 2.4.15');
    expect(before.head).toContain('Update all (1)');
    expect(before.buttons[0]).toEqual(['Update']);

    await app.locator('.vendor-update-list li button:text-is("Update")').click();
    await expect(app.locator('.vendor-updates .success')).toContainText('Updated PrusaResearch 2.4.14 → 2.4.15');
    await closeDialog(app, 'escape');
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
    await openDialog(app, 'addPrinter');

    await app.locator('.vendor-update-list li button:text-is("Update")').click();
    await expect(app.locator('.vendor-updates .error')).toContainText('was refused');
    const after = await section(app);
    expect(after.refusals).toHaveLength(1);
    expect(after.refusals[0]).toContain('Bad Filament');
    expect(after.refusals[0]).toContain('config.hotend_limit');
    // the bundle is still the installed one
    expect(after.versions[0]).toContain('2.4.14');
    await closeDialog(app, 'escape');
  });

  test('with the check switched off the section says so and offers a file instead', async ({ app }) => {
    await mockRoutes(app, list({ enabled: false, checkedAt: null }), installed());
    await openDialog(app, 'addPrinter');

    const off = await section(app);
    expect(off.disabled).toBe(true);
    expect(off.fileInput).toBe(true);
    expect(off.head).toEqual([]);
    // the vendor/model lists still work, they come from the image
    expect(await app.locator('.vendor-list li').count()).toBeGreaterThan(1);
    await closeDialog(app, 'escape');
  });
});
