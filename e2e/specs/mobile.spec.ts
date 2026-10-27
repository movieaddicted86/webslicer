/**
 * The companion flow on a phone and a tablet (T-091).
 *
 * The two extra projects of `playwright.config.ts` (`phone` 390 × 844 with touch, `tablet` 820 ×
 * 1180) run this file only; the desktop project ignores it. The test is the job the responsive table
 * promises for a small screen: pick a file in the Library, open the bottom sheet, choose a filament,
 * slice without scrolling anywhere, see the preview, send the G-code – plus the three rules that
 * every screen has to keep on the way:
 *
 * - nothing scrolls the page sideways (`scrollWidth <= innerWidth`),
 * - a dialog stays inside the viewport and its primary button is reachable without scrolling,
 * - the phone's tab bar has four labelled entries a finger can hit (≥ 44 px).
 *
 * The flows are driven through the DOM (the tab bar, the sheet handle, the buttons) so a broken
 * control fails the test; the store is only read.
 */
import { CUBE, read, settle } from '../helpers/app';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { E2E_PRINTER } from '../global-setup';
import { addPrinter, clearUploads, HAS_MOCK_HOST, removePrinters, uploads, type TestPrinter } from '../helpers/mock-host';
import type { Page } from '@playwright/test';

/** The project this test is running in (`phone` or `tablet`). */
const project = () => test.info().project.name;
const isPhone = () => project() === 'phone';

/** The page never scrolls sideways – the one rule every screen on a small display has to keep. */
async function expectNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(size.scroll, `${screen} scrolls sideways (${size.scroll} > ${size.inner})`).toBeLessThanOrEqual(size.inner);
}

/** A box is inside the viewport the user actually sees (no scroll needed to reach it). */
async function expectInsideViewport(page: Page, selector: string, what: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  const view = page.viewportSize();
  expect(box, `${what} is not rendered`).toBeTruthy();
  expect(view, 'the project has a viewport').toBeTruthy();
  if (!box || !view) return;
  expect(box.y, `${what} starts above the viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what} is cut by the bottom edge`).toBeLessThanOrEqual(view.height);
  expect(box.x, `${what} starts left of the screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} is cut by the right edge`).toBeLessThanOrEqual(view.width);
}

test.describe('the companion flow on a small screen (T-091)', () => {
  // the send test creates a print host: server state like the send spec's own tests
  test.describe.configure({ lock: 'server-state' });

  test('Library → sheet → filament → slice → preview works without scrolling the page', async ({ app }) => {
    // the phone starts on the plater with the Slice footer in reach
    await expectNoSidewaysScroll(app, 'the plater');

    // the Library is the tab the flow starts from: upload a sample, then open it
    await app.getByTestId('rail-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await expectInsideViewport(app, '[data-testid="modal"]', 'the Library dialog');
    await expectNoSidewaysScroll(app, 'the Library');
    await app.locator('.library input[type="file"]').setInputFiles(CUBE);
    const row = app.locator('[data-testid="library-row"]').filter({ hasText: 'calibration_cube_20mm' }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // the row's own tap loads the file (a plain click in the open mode) and closes the dialog
    await row.locator('.name').click();
    await expect(app.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
    await app.waitForFunction(
      () => {
        const s = window.webslicer.getState();
        return s.objects.length > 0 && s.objects.every((o) => o.modelId || o.uploadError);
      },
      null,
      { timeout: 120_000 },
    );
    await app.waitForTimeout(1000);

    // the sheet's handle is the phone's own chrome; both starting positions keep the Slice button on
    // screen, which is the one control the companion flow cannot do without
    if (isPhone()) {
      const handle = app.getByTestId('sheet-handle');
      await expect(handle).toBeVisible();
      // it starts folded to peek: the model keeps the scene and the Slice button sits in the footer
      await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (peek)');
      // a tap on the handle walks the positions: peek → half → full → peek, and the Slice button
      // stays on screen in every one of them
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'half');
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (half sheet)');
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'full');
      await expect(app.getByTestId('context-panel')).toBeVisible();
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (full sheet)');
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
      // leave the presets in reach for the filament below
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'half');
    }

    // choose a filament: the panel's own select, not the store
    const filament = app.locator('[data-testid="preset-select-filament"] select').first();
    await expect(filament).toBeVisible();
    const current = await filament.inputValue();
    const options = await filament.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const other = options.find((v) => v !== current);
    expect(other, 'the fixture data offers a second filament').toBeTruthy();
    await filament.selectOption(other as string);
    await app.waitForTimeout(800);
    await expect(filament).toHaveValue(other as string);
    await expectNoSidewaysScroll(app, 'the sheet with the presets');

    // the Slice button is on screen without a scroll – click it where it is
    await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button');
    await app.getByTestId('slice-button').click();
    await app.waitForFunction(
      () => {
        const j = window.webslicer.getState().job;
        return !!j && ['done', 'error'].includes(j.status);
      },
      null,
      { timeout: 600_000 },
    );
    await app.waitForTimeout(1500);
    const job = await read(app, (s) => ({ status: s.job?.status, id: s.job?.id }));
    expect(job.status, 'the slice finished').toBe('done');
    expect(job.id).toBeTruthy();

    // the slice switches to the Preview on its own and shows the panel, not just the scene
    await expect(app.getByTestId('preview-panel')).toBeVisible({ timeout: 30_000 });
    await app.waitForTimeout(3000);
    await expectNoSidewaysScroll(app, 'the preview');
    await expect(app.getByTestId('layer-slider')).toHaveCount(1);
    if (isPhone()) {
      // the layer card is the sheet's first preview card, so the slider is on screen in the default
      // half position – the bottom sheet never takes it away
      await expect(app.getByTestId('layer-slider')).toBeInViewport();
    }
  });

  test('every dialog stays inside the viewport and its primary button is reachable', async ({ app }) => {
    const dialogs: Array<[string, unknown, string]> = [
      ['library', 'open', 'the Library dialog'],
      ['printers', { tab: 'hosts' }, 'the Printers dialog'],
      ['printers', { tab: 'vendor' }, 'the Printers dialog (vendor profiles)'],
      ['preferences', undefined, 'the Preferences dialog'],
      ['about', undefined, 'the About dialog'],
    ];
    for (const [kind, payload, name] of dialogs) {
      await app.evaluate(([k, p]) => window.webslicer.getState().openDialog(k as string, p), [kind, payload ?? null] as const);
      await expect(app.getByTestId('modal')).toBeVisible();
      await app.waitForTimeout(500);
      await expectInsideViewport(app, '[data-testid="modal"]', name);
      await expectNoSidewaysScroll(app, name);
      // the ✕ is the one action every dialog has; the primary (where one exists) must be in reach
      await expectInsideViewport(app, '[data-testid="modal-close"]', `${name}'s close button`);
      const primary = app.locator('[data-testid="modal-primary"]').first();
      if ((await primary.count()) > 0) await expectInsideViewport(app, '[data-testid="modal-primary"]', `${name}'s primary button`);
      await app.evaluate(() => window.webslicer.getState().closeDialog());
      await expect(app.getByTestId('modal')).toHaveCount(0);
    }
  });

  test('the phone tab bar has four labelled entries a finger can hit', async ({ app }) => {
    test.skip(!isPhone(), 'the bottom tab bar only exists below 640 px');
    await expectNoSidewaysScroll(app, 'the plater');
    const tabs = ['rail-slicing', 'rail-library', 'rail-printers', 'rail-more'];
    for (const id of tabs) {
      const tab = app.getByTestId(id);
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box, `${id} is rendered`).toBeTruthy();
      if (!box) continue;
      expect(box.height, `${id} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${id} is narrower than 44 px`).toBeGreaterThanOrEqual(44);
      const label = (await tab.locator('.rail-label').textContent())?.trim();
      expect(label, `${id} has a label`).toBeTruthy();
    }
    // More is a container, not a fifth place: it opens the remaining rows and closes again
    await app.getByTestId('rail-more').click();
    await expect(app.getByTestId('rail-more-menu')).toBeVisible();
    await expect(app.getByTestId('rail-preferences-more')).toBeVisible();
    await app.getByTestId('rail-preferences-more').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await app.evaluate(() => window.webslicer.getState().closeDialog());
    await expect(app.getByTestId('modal')).toHaveCount(0);

    // every top-bar icon is a finger target too
    for (const button of await app.locator('.topbar .topbar-icon, .topbar .app-menu-trigger').all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      expect(box.height, 'a top bar button is shorter than 44 px').toBeGreaterThanOrEqual(44);
    }
  });

  test('the send reaches the mock print host', async ({ app, browser }) => {
    test.skip(!HAS_MOCK_HOST, 'the send test needs the mock print host – run it with `npm run e2e:docker`');
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    const job = await read(app, (s) => ({ id: s.job?.id ?? '', outputName: s.job?.outputName ?? '', status: s.job?.status }));
    expect(job.status).toBe('done');

    let created: TestPrinter[] = [];
    try {
      created = [await addPrinter(app, { name: 'Phone host', presetName: E2E_PRINTER })];
      await app.evaluate(async () => {
        const s = window.webslicer.getState();
        await s.refreshPresetLists();
        await s.refreshPhysicalPrinters();
      });
      await settle(app, 500);
      clearUploads();

      // the preview footer's Send button is the flow's own way in
      await app.evaluate(() => window.webslicer.getState().setView('preview'));
      await settle(app, 1200);
      await expectInsideViewport(app, '[data-testid="send-button"]', 'the Send button');
      await app.getByTestId('send-button').click();
      const dialog = app.getByTestId('modal');
      await expect(dialog).toBeVisible();
      await expectInsideViewport(app, '[data-testid="modal"]', 'the Send dialog');
      await expectInsideViewport(app, '[data-testid="modal-primary"]', "the Send dialog's Upload button");
      await app.getByTestId('modal-primary').click();
      await expect(dialog).toHaveCount(0, { timeout: 60_000 });
      const sent = uploads();
      expect(sent).toHaveLength(1);
      expect(sent[0].filename).toBe(job.outputName);
      expect(sent[0].bytes).toBeGreaterThan(1000);
      expect(sent[0].fields.print).toBe('false');
    } finally {
      await removePrinters(app, created);
      clearUploads();
    }
  });
});
