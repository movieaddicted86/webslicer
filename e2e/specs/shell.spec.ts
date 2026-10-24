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

    // Slicing is the current place on the plater and in the preview; the settings views move it
    for (const [hook, view] of [
      ['rail-slicing', 'plater'],
      ['rail-preferences', 'print'],
      ['rail-preferences', 'filament'],
      ['rail-preferences', 'printer'],
      ['rail-slicing', 'preview'],
    ] as const) {
      await app.evaluate((v) => window.webslicer.getState().setView(v), view);
      await app.waitForTimeout(300);
      await expect(byId(app, hook)).toHaveAttribute('aria-current', 'page');
    }
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(300);
    await expect(byId(app, 'rail-preferences')).not.toHaveAttribute('aria-current', 'page');
  });

  test('Library, Printers and About open their dialogs from the rail', async ({ app }) => {
    for (const [hook, dialog] of [
      ['rail-library', 'library'],
      ['rail-printers', 'physicalPrinters'],
      ['rail-about', 'about'],
    ] as const) {
      await byId(app, hook).click();
      await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
      expect(await dialogKind(app)).toBe(dialog);
      await app.keyboard.press('Escape');
      await app.waitForTimeout(500);
      expect(await dialogKind(app)).toBeUndefined();
    }
  });

  test('the menu opens, lists the old top bar actions and closes on Escape with the focus back', async ({ app }) => {
    const menu = byId(app, 'menu');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');

    const labels = await app
      .locator('[data-testid="menu-panel"] [role="menuitem"]')
      .allInnerTexts()
      .then((texts) => texts.map((t) => t.replace(/\s+/g, ' ').trim()));
    // every action the wide bar carried is reachable from here
    expect(labels.join(' | ')).toContain('Import models');
    expect(labels.join(' | ')).toContain('Import presets');
    expect(labels.join(' | ')).toContain('Open from library');
    expect(labels.join(' | ')).toContain('Save project to library');
    expect(labels.join(' | ')).toContain('Export');
    expect(labels.join(' | ')).toContain('Mode');
    expect(labels.join(' | ')).toContain('Printers');
    expect(labels.join(' | ')).toContain('About');

    // the export submenu carries the six export entries of the old dropdown
    await app.locator('[data-testid="menu-export"]').click();
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

  test('the menu switches the mode and opens the printers and About dialogs', async ({ app }) => {
    await byId(app, 'menu').click();
    await app.locator('[data-testid="menu-mode"]').click();
    await app.waitForTimeout(300);
    await app.locator('.app-menu-flyout[aria-label="Mode"] [role="menuitemradio"]', { hasText: 'Expert' }).click();
    await app.waitForTimeout(400);
    expect(await read(app, (s) => s.mode)).toBe('expert');
    expect(await app.locator('[data-testid="menu-panel"]').count()).toBe(0);

    // back to Advanced for the rest of the file
    await app.evaluate(() => window.webslicer.getState().setMode('advanced'));
    await app.waitForTimeout(300);
  });

  test('the hide-panels toggle frees the scene, survives a reload and keeps the canvas in step', async ({ app }) => {
    await importFile(app, CUBE);
    await settle(app, 800);

    const shown = await sceneSizes(app);
    expect(shown.zone).toBeGreaterThan(0);
    await expect(byId(app, 'sidebar')).toBeVisible();

    const toggle = byId(app, 'hide-panels');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await settle(app, 800);

    const hidden = await sceneSizes(app);
    // the freed width is the sidebar's: the scene really grew, and the canvas followed it
    expect(hidden.zone).toBeGreaterThan(shown.zone + 200);
    expect(Math.abs(hidden.canvas - hidden.zone)).toBeLessThanOrEqual(2);
    expect(Math.abs(hidden.buffer - hidden.canvas)).toBeLessThanOrEqual(4);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await app.locator('[data-testid="sidebar"]').isVisible()).toBe(false);

    // the choice is remembered per browser
    expect(await app.evaluate(() => localStorage.getItem('webslicer.panelsHidden'))).toBe('on');
    await app.reload({ waitUntil: 'networkidle' });
    await app.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
    await settle(app, 600);
    await expect(byId(app, 'hide-panels')).toHaveAttribute('aria-pressed', 'true');
    expect(await app.locator('[data-testid="sidebar"]').isVisible()).toBe(false);

    // and back: the panels return and the scene shrinks again
    await byId(app, 'hide-panels').click();
    await settle(app, 800);
    await expect(byId(app, 'sidebar')).toBeVisible();
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
