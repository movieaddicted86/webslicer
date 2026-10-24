/**
 * The app shell (layout 3.0, L-1): the rail, the slim top bar's menu, the hide-panels toggle and the
 * narrow layouts.
 *
 * The specs drive the real controls – the rail buttons, the menu, the toggle – and read the store only
 * for what the user cannot see (the persisted flag). The regions are located by their hooks, so a
 * later step may move the pieces again without touching this file.
 */
import { CUBE, importFile, read, settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { byId } from '../helpers/hooks';
import { dialogKind } from '../helpers/dom';
import type { Page } from '@playwright/test';

/** The scene container's width, and the size the renderer gave the canvas. */
async function sceneSizes(app: Page) {
  return app.evaluate(() => {
    const zone = document.querySelector('.dropzone') as HTMLElement;
    const canvas = document.querySelector('.viewer canvas') as HTMLCanvasElement;
    return {
      zone: Math.round(zone.getBoundingClientRect().width),
      canvas: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
      buffer: canvas ? canvas.width : 0,
    };
  });
}

test.describe('shell: the rail and the slim top bar', () => {
  test('the rail carries the app places and marks the current one', async ({ app }) => {
    const rail = byId(app, 'rail');
    await expect(rail).toBeVisible();
    await expect(rail).toHaveAttribute('aria-label', 'Main');

    // Slicing is the current place on the plater and in the preview
    for (const [hook, view] of [
      ['rail-slicing', 'plater'],
      ['rail-slicing', 'preview'],
    ] as const) {
      await app.evaluate((v) => window.webslicer.getState().setView(v), view);
      await app.waitForTimeout(300);
      await expect(byId(app, hook)).toHaveAttribute('aria-current', 'page');
    }

    // the settings views are not a place of their own any more: no rail item is current there
    for (const view of ['print', 'filament', 'printer'] as const) {
      await app.evaluate((v) => window.webslicer.getState().setView(v), view);
      await app.waitForTimeout(300);
      expect(await app.locator('[data-testid="rail"] [aria-current="page"]').count()).toBe(0);
    }
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(300);
    await expect(byId(app, 'rail-preferences')).not.toHaveAttribute('aria-current', 'page');
  });

  test('Library, Printers, Preferences and About open their dialogs from the rail', async ({ app }) => {
    for (const [hook, dialog, title] of [
      ['rail-library', 'library', undefined],
      ['rail-printers', 'printers', 'Printers'],
      ['rail-preferences', 'preferences', 'Preferences'],
      ['rail-about', 'about', undefined],
    ] as const) {
      await byId(app, hook).click();
      await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
      expect(await dialogKind(app)).toBe(dialog);
      if (title) await expect(app.locator('[data-testid="modal-title"]')).toHaveText(title);
      await app.keyboard.press('Escape');
      await app.waitForTimeout(500);
      expect(await dialogKind(app)).toBeUndefined();
    }
  });

  test('the menu opens, lists import and Export, and closes on Escape with the focus back', async ({ app }) => {
    const menu = byId(app, 'menu');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');

    const labels = await app
      .locator('[data-testid="menu-panel"] [role="menuitem"]')
      .allInnerTexts()
      .then((texts) => texts.map((t) => t.replace(/\s+/g, ' ').trim()));
    // the menu keeps only what has no other home: import and the Export submenu
    expect(labels.join(' | ')).toContain('Import models');
    expect(labels.join(' | ')).toContain('Import presets');
    expect(labels.join(' | ')).toContain('Export');
    for (const gone of ['Open from library', 'Save project to library', 'Mode', 'Printers', 'About']) {
      expect(labels.join(' | ')).not.toContain(gone);
    }

    // the export submenu carries the six export entries of the old dropdown
    await app.locator('[data-testid="menu-export"]').hover();
    await app.waitForTimeout(300);
    const exports = await app
      .locator('.app-menu-flyout[aria-label="Export"] [role="menuitem"]')
      .allInnerTexts()
      .then((texts) => texts.map((t) => t.trim()));
    expect(exports).toEqual([
      'Export project as 3MF',
      'Export current settings (.ini)',
      'Export presets (.ini bundle)',
      'Export G-code',
      'Save project to library…',
      'Save G-code to library…',
    ]);

    // Escape closes the submenu first, the menu second, and the keyboard user keeps their place
    await app.keyboard.press('Escape');
    await app.waitForTimeout(200);
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(await app.locator('[data-testid="menu-panel"]').count()).toBe(1);
    expect(await app.locator('.app-menu-flyout[aria-label="Export"]').count()).toBe(0);

    await app.keyboard.press('Escape');
    await app.waitForTimeout(200);
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(await app.locator('[data-testid="menu-panel"]').count()).toBe(0);
    // the closed menu hands the focus back to its trigger
    expect(await app.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('menu');
  });

  test('Preferences switches the mode – the menu no longer carries it', async ({ app }) => {
    await byId(app, 'rail-preferences').click();
    await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
    await app.getByRole('radio', { name: /Expert/ }).check();
    await app.waitForTimeout(400);
    expect(await read(app, (s) => s.mode)).toBe('expert');
    // the dialog stays open while the mode changes behind it
    expect(await app.locator('[data-testid="modal"]').count()).toBe(1);
    await app.keyboard.press('Escape');
    await app.waitForTimeout(500);

    // back to Advanced for the rest of the file
    await app.evaluate(() => window.webslicer.getState().setMode('advanced'));
    await app.waitForTimeout(300);
  });

  test('Preferences resets the stored panel layout', async ({ app }) => {
    await app.evaluate(() => localStorage.setItem('webslicer.leftWidth', '380'));
    await byId(app, 'rail-preferences').click();
    await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
    await byId(app, 'preferences-reset-layout').click();
    await app.waitForTimeout(500);
    // the stored choice is gone and the column is back at its default width
    expect(await app.evaluate(() => localStorage.getItem('webslicer.leftWidth'))).toBeNull();
    expect(await read(app, (s) => s.leftWidth)).toBe(300);
    await app.keyboard.press('Escape');
    await app.waitForTimeout(500);
  });

  test('the hide-panels toggle frees the scene, survives a reload and keeps the canvas in step', async ({ app }) => {
    await importFile(app, CUBE);
    await settle(app, 800);

    const shown = await sceneSizes(app);
    expect(shown.zone).toBeGreaterThan(0);
    await expect(byId(app, 'context-panel')).toBeVisible();

    const toggle = byId(app, 'hide-panels');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await settle(app, 800);

    const hidden = await sceneSizes(app);
    // the freed width is the context panel's: the scene really grew, and the canvas followed it
    expect(hidden.zone).toBeGreaterThan(shown.zone + 200);
    expect(Math.abs(hidden.canvas - hidden.zone)).toBeLessThanOrEqual(2);
    expect(Math.abs(hidden.buffer - hidden.canvas)).toBeLessThanOrEqual(4);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await app.locator('[data-testid="context-panel"]').isVisible()).toBe(false);

    // the choice is remembered per browser
    expect(await app.evaluate(() => localStorage.getItem('webslicer.panelsHidden'))).toBe('on');
    await app.reload({ waitUntil: 'networkidle' });
    await app.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
    await settle(app, 600);
    await expect(byId(app, 'hide-panels')).toHaveAttribute('aria-pressed', 'true');
    expect(await app.locator('[data-testid="context-panel"]').isVisible()).toBe(false);

    // and back: the panels return and the scene shrinks again
    await byId(app, 'hide-panels').click();
    await settle(app, 800);
    await expect(byId(app, 'context-panel')).toBeVisible();
    expect((await sceneSizes(app)).zone).toBeLessThanOrEqual(shown.zone + 2);
  });

  test('the narrow layouts keep the app inside the window width', async ({ app }) => {
    await importFile(app, CUBE);
    await settle(app, 800);

    // the tablet width: the rail is icons only, the names are gone from the DOM's paint
    await app.setViewportSize({ width: 900, height: 700 });
    await app.waitForTimeout(600);
    expect(await app.locator('.rail-label').first().isVisible()).toBe(false);

    // the phone width: the rail is a bottom tab bar with the names back, nothing overflows
    await app.setViewportSize({ width: 360, height: 740 });
    await app.waitForTimeout(800);
    const narrow = await app.evaluate(() => {
      const doc = document.documentElement;
      const rail = document.querySelector('[data-testid="rail"]') as HTMLElement;
      const scene = document.querySelector('.dropzone') as HTMLElement;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        // the tab bar sits under the scene, not beside it
        railBelowScene: rail.getBoundingClientRect().top >= scene.getBoundingClientRect().bottom - 1,
        labels: Array.from(document.querySelectorAll('.rail-label')).filter((el) => (el as HTMLElement).offsetParent !== null).length,
      };
    });
    expect(narrow.overflow).toBeLessThanOrEqual(0);
    expect(narrow.railBelowScene).toBe(true);
    expect(narrow.labels).toBe(5);

    // the bottom bar still navigates
    await byId(app, 'rail-about').click();
    await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
    expect(await dialogKind(app)).toBe('about');
    await app.keyboard.press('Escape');
    await app.waitForTimeout(500);
  });
});
