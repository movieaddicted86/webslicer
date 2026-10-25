/**
 * The menu's behaviour (layout 3.0): one submenu at a time, opened by hover or click, closed when the
 * pointer leaves the item and its flyout – with a short grace so the pointer can cross the gap – and
 * closed completely when the pointer leaves the menu. Escape closes the submenu first and the menu
 * second; the arrows walk the items, ArrowRight enters a flyout and ArrowLeft leaves it.
 *
 * The unit test `web/src/components/menu/menuState.test.ts` pins the same rules on the pure machine;
 * this file drives the DOM a user actually touches.
 */
import { expect, test } from '../helpers/fixtures';
import { byId } from '../helpers/hooks';
import type { Page } from '@playwright/test';

/** The Export flyout, named by its accessible name. */
const flyout = (app: Page) => app.getByRole('menu', { name: 'Export' });
/** The Settings flyout. */
const settingsFlyout = (app: Page) => app.getByRole('menu', { name: 'Settings' });

test.describe('menu: one submenu, opened by hover or click', () => {
  test('hovering Export opens its flyout; another top-level item takes it away at once', async ({ app }) => {
    await byId(app, 'menu').click();
    await expect(byId(app, 'menu-panel')).toBeVisible();
    await expect(flyout(app)).toHaveCount(0);

    await byId(app, 'menu-export').hover();
    await expect(flyout(app)).toBeVisible();
    await expect(byId(app, 'menu-export')).toHaveAttribute('aria-expanded', 'true');

    // the pointer moves to a plain item: the open flyout closes, the menu stays
    await app.getByRole('menuitem', { name: 'Import presets' }).hover();
    await expect(flyout(app)).toHaveCount(0);
    await expect(byId(app, 'menu-panel')).toBeVisible();
  });

  test('the flyout stays open while the pointer crosses into it, and closes after the grace when it leaves', async ({ app }) => {
    await byId(app, 'menu').click();
    await byId(app, 'menu-export').hover();
    await expect(flyout(app)).toBeVisible();

    // crossing the gap between item and flyout must not close it
    await flyout(app).getByRole('menuitem', { name: 'Export current settings' }).hover();
    await app.waitForTimeout(400);
    await expect(flyout(app)).toBeVisible();

    // leaving the item and its flyout starts the grace; afterwards only the menu remains
    await app.getByRole('menuitem', { name: 'Import models' }).hover();
    await app.waitForTimeout(400);
    await expect(flyout(app)).toHaveCount(0);
    await expect(byId(app, 'menu-panel')).toBeVisible();
  });

  test('leaving the whole menu closes everything after the grace', async ({ app }) => {
    await byId(app, 'menu').click();
    await byId(app, 'menu-export').hover();
    await expect(flyout(app)).toBeVisible();

    await app.mouse.move(600, 700);
    await app.waitForTimeout(400);
    await expect(flyout(app)).toHaveCount(0);
    await expect(byId(app, 'menu-panel')).toHaveCount(0);
    await expect(byId(app, 'menu')).toHaveAttribute('aria-expanded', 'false');
  });

  test('a click keeps the flyout open; Escape closes the flyout first and the menu second', async ({ app }) => {
    await byId(app, 'menu').click();
    await byId(app, 'menu-export').click();
    await app.waitForTimeout(400);
    await expect(flyout(app)).toBeVisible();
    await expect(byId(app, 'menu-export')).toHaveAttribute('aria-expanded', 'true');

    await app.keyboard.press('Escape');
    await expect(flyout(app)).toHaveCount(0);
    await expect(byId(app, 'menu-panel')).toBeVisible();

    await app.keyboard.press('Escape');
    await expect(byId(app, 'menu-panel')).toHaveCount(0);
    await expect(byId(app, 'menu')).toHaveAttribute('aria-expanded', 'false');
    // the closed menu hands the focus back to its trigger
    expect(await app.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('menu');
  });

  test('a tap opens the flyout and keeps it until something else is tapped', async ({ app }) => {
    // a touch tap sends a click without a hover: the flyout must open and stay open
    await byId(app, 'menu').dispatchEvent('click');
    await expect(byId(app, 'menu-panel')).toBeVisible();
    await byId(app, 'menu-export').dispatchEvent('click');
    await app.waitForTimeout(400);
    await expect(flyout(app)).toBeVisible();

    // a tap outside closes the menu
    await app.mouse.click(600, 700);
    await app.waitForTimeout(400);
    await expect(byId(app, 'menu-panel')).toHaveCount(0);
  });

  test('the keyboard walks the menu, enters the flyout with ArrowRight and leaves it with ArrowLeft', async ({ app }) => {
    await byId(app, 'menu').click();
    // ArrowDown on the trigger moves into the panel
    await app.keyboard.press('ArrowDown');
    await expect(app.getByRole('menuitem', { name: 'Import models' })).toBeFocused();

    await app.keyboard.press('ArrowDown');
    await expect(app.getByRole('menuitem', { name: 'Import presets' })).toBeFocused();
    // the two flyouts follow the plain items, Settings first
    await app.keyboard.press('ArrowDown');
    await expect(byId(app, 'menu-settings')).toBeFocused();
    await app.keyboard.press('ArrowDown');
    await expect(byId(app, 'menu-export')).toBeFocused();

    await app.keyboard.press('ArrowRight');
    await expect(flyout(app)).toBeVisible();
    await expect(byId(app, 'menu-export')).toHaveAttribute('aria-expanded', 'true');
    // ArrowRight enters the flyout: the first action that is enabled takes the focus
    await expect(app.getByRole('menuitem', { name: 'Export current settings (.ini)' })).toBeFocused();

    await app.keyboard.press('ArrowLeft');
    await expect(flyout(app)).toHaveCount(0);
    await expect(byId(app, 'menu-export')).toHaveAttribute('aria-expanded', 'false');
    await expect(byId(app, 'menu-export')).toBeFocused();
  });

  test('Menu → Settings opens its flyout and one of its views', async ({ app }) => {
    await byId(app, 'menu').click();
    await byId(app, 'menu-settings').hover();
    await expect(settingsFlyout(app)).toBeVisible();
    await expect(settingsFlyout(app).getByRole('menuitem')).toHaveText(['Print settings', 'Filament settings', 'Printer settings']);

    // another flyout takes over at once; the Settings one is gone
    await byId(app, 'menu-export').hover();
    await expect(flyout(app)).toBeVisible();
    await expect(settingsFlyout(app)).toHaveCount(0);

    // a click on a settings view closes the menu and lands on that view
    await byId(app, 'menu-settings').click();
    await settingsFlyout(app).getByRole('menuitem', { name: 'Filament settings' }).click();
    await expect(byId(app, 'menu-panel')).toHaveCount(0);
    await expect.poll(() => app.evaluate(() => window.webslicer.getState().view)).toBe('filament');
  });
});
