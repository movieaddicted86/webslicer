/**
 * Navigation (layout 3.0): every function has exactly one home, the rail, the menu and the preset rows
 * render the navigation map, and no label appears in two regions. The spec reads the same table the
 * components render (`web/src/nav/navMap.ts`), so a function added in two places fails here.
 *
 * The walk drives each home once: the rail's places and dialogs, the menu's import list and its two
 * flyouts (Settings, Export), the settings button of every preset row, the quick settings' "All
 * settings…" and the printer dropdown's way into the unified Printers dialog.
 *
 * The three settings views are the stated exception to "one home": Menu → Settings and the preset row
 * both open them, and the spec drives both doors.
 */
import { expect, test } from '../helpers/fixtures';
import { byId } from '../helpers/hooks';
import { dialogKind } from '../helpers/dom';
import { read } from '../helpers/app';
import {
  EXPORT_ENTRIES,
  MENU_ENTRIES,
  MENU_SUBMENUS,
  PRESET_PRINTERS_ENTRY,
  RAIL_ENTRIES,
  SETTINGS_ENTRIES,
  VIEW_SWITCH_ENTRIES,
} from '../../web/src/nav/navMap';
import type { Page } from '@playwright/test';

/** The `data-nav-id`s under a hook, in DOM order. */
async function navIds(app: Page, selector: string): Promise<Array<string | null>> {
  return app.locator(selector).evaluateAll((els) => els.map((e) => e.getAttribute('data-nav-id')));
}

/** Close whatever is open and let the layout settle. */
async function closeAll(app: Page): Promise<void> {
  await app.keyboard.press('Escape');
  await app.waitForTimeout(400);
  await app.keyboard.press('Escape');
  await app.waitForTimeout(400);
}

test.describe('navigation: one home per function', () => {
  test('the rail, the menu, its flyouts and the preset rows render exactly the navigation map', async ({ app }) => {
    expect(await navIds(app, '[data-testid="rail"] [data-nav-id]')).toEqual(RAIL_ENTRIES.map((e) => e.id));

    await byId(app, 'menu').click();
    await expect(byId(app, 'menu-panel')).toBeVisible();
    // both flyouts are still closed: the panel holds the two import entries and the two flyout triggers
    expect(await navIds(app, '[data-testid="menu-panel"] [data-nav-id]')).toEqual([
      ...MENU_ENTRIES.map((e) => e.id),
      ...MENU_SUBMENUS.map((s) => s.id),
    ]);

    await byId(app, 'menu-settings').hover();
    await expect(app.getByRole('menu', { name: 'Settings' })).toBeVisible();
    expect(await navIds(app, '[role="menu"][aria-label="Settings"] [data-nav-id]')).toEqual(SETTINGS_ENTRIES.map((e) => e.id));

    await byId(app, 'menu-export').hover();
    await expect(app.getByRole('menu', { name: 'Export' })).toBeVisible();
    expect(await navIds(app, '[role="menu"][aria-label="Export"] [data-nav-id]')).toEqual(EXPORT_ENTRIES.map((e) => e.id));
    await closeAll(app);

    // one settings button per preset row, and no other settings entry there
    const buttons = await navIds(app, '[data-testid="presets"] [data-nav-id]');
    expect([...buttons].sort()).toEqual(SETTINGS_ENTRIES.map((e) => e.id).sort());
  });

  test('no label appears in two of the rail, the menu and the top bar', async ({ app }) => {
    await byId(app, 'menu').click();
    await expect(byId(app, 'menu-panel')).toBeVisible();
    const names = await app.evaluate(() => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const pick = (sel: string, attr: 'title' | 'aria-label' | 'text') =>
        Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) =>
          norm(attr === 'text' ? el.textContent : el.getAttribute(attr) || el.textContent),
        );
      return {
        rail: pick('[data-testid="rail"] button', 'title'),
        // the flyout is closed here, so this is the menu's own three items
        menu: pick('[data-testid="menu-panel"] [role="menuitem"]', 'text'),
        // the open menu lives inside the bar's DOM: its items are the menu's labels, not the bar's
        bar: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="top-bar"] button'))
          .filter((el) => !el.closest('[data-testid="menu-panel"]'))
          .map((el) => norm(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent)),
      };
    });
    const all = [
      ...names.rail.map((label) => ({ label, home: 'rail' })),
      ...names.menu.map((label) => ({ label, home: 'menu' })),
      ...names.bar.map((label) => ({ label, home: 'top bar' })),
    ];
    const duplicates = all.filter((entry, i) => all.findIndex((other) => other.label === entry.label) !== i);
    expect(duplicates).toEqual([]);
    await closeAll(app);
  });

  test('every rail place opens its home', async ({ app }) => {
    for (const entry of RAIL_ENTRIES) {
      if (entry.action.kind === 'view') {
        // Slicing returns to the plater from wherever the user was
        await app.evaluate(() => window.webslicer.getState().setView('preview'));
        await app.waitForTimeout(300);
        await byId(app, entry.testId ?? `rail-${entry.id}`).click();
        await expect.poll(() => read(app, (s) => s.view)).toBe(entry.action.view);
        continue;
      }
      if (entry.action.kind !== 'dialog') continue;
      await byId(app, entry.testId ?? `rail-${entry.id}`).click();
      await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
      expect(await dialogKind(app)).toBe(entry.action.dialog);
      if (entry.action.dialog === 'printers') {
        await expect(app.locator('[data-testid="modal-title"]')).toHaveText('Printers');
        await expect(app.getByRole('tab', { name: 'My printers' })).toHaveAttribute('aria-selected', 'true');
      }
      await app.keyboard.press('Escape');
      await app.waitForTimeout(500);
      expect(await dialogKind(app)).toBeUndefined();
    }
  });

  test('the printer dropdown opens the one Printers dialog on its vendor profiles', async ({ app }) => {
    await app.locator('[data-testid="preset-select-printer"] select').selectOption(PRESET_PRINTERS_ENTRY.id);
    await app.waitForSelector('[data-testid="modal"]', { state: 'visible', timeout: 20_000 });
    expect(await dialogKind(app)).toBe('printers');
    await expect(app.locator('[data-testid="modal-title"]')).toHaveText('Printers');
    await expect(app.getByRole('tab', { name: 'Vendor profiles' })).toHaveAttribute('aria-selected', 'true');
    await closeAll(app);
  });

  test('each settings view opens from its preset row and from Menu → Settings', async ({ app }) => {
    for (const entry of SETTINGS_ENTRIES) {
      if (entry.action.kind !== 'view') continue;
      await app.evaluate(() => window.webslicer.getState().setView('plater'));
      await app.waitForTimeout(400);
      const button = app.locator(`[data-testid="settings-open-${entry.action.view}"]`);
      await expect(button).toBeVisible();
      // the picture is the sliders, not the cog: the cog means Preferences alone
      await expect(button.locator('svg')).toHaveCount(1);
      await expect(button).toHaveAttribute('title', /^Edit .* settings$/);
      await button.click();
      await expect.poll(() => read(app, (s) => s.view)).toBe(entry.action.view);
    }

    // the Prepare | Preview switch is one segmented control in the top bar; the strip carries the tools
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(400);
    expect(await app.locator('[data-testid="top-bar"] nav').count()).toBe(0);
    expect(await app.locator('[data-testid="tool-bar"] [data-nav-id]').count()).toBe(0);
    expect(await navIds(app, '[data-testid="view-switch"] [data-nav-id]')).toEqual(VIEW_SWITCH_ENTRIES.map((e) => e.id));
    for (const entry of VIEW_SWITCH_ENTRIES) {
      if (entry.action.kind !== 'view') continue;
      await byId(app, entry.testId ?? entry.id).click();
      await expect.poll(() => read(app, (s) => s.view)).toBe(entry.action.view);
    }
  });

  test('Menu → Settings opens every settings view, by pointer and by keyboard', async ({ app }) => {
    for (const entry of SETTINGS_ENTRIES) {
      if (entry.action.kind !== 'view') continue;
      await app.evaluate(() => window.webslicer.getState().setView('plater'));
      await app.waitForTimeout(400);
      await byId(app, 'menu').click();
      await byId(app, 'menu-settings').click();
      const flyout = app.getByRole('menu', { name: 'Settings' });
      await expect(flyout).toBeVisible();
      await flyout.getByRole('menuitem', { name: new RegExp(`^${entry.label}`) }).click();
      await expect.poll(() => read(app, (s) => s.view)).toBe(entry.action.view);
    }

    // the keyboard's way in: the trigger, ArrowDown to the Settings item, ArrowRight into its flyout
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(400);
    await byId(app, 'menu').click();
    // The trigger moves the focus into the panel in a `requestAnimationFrame`, so the first press in
    // a burst can still be handled by the trigger while the panel does not exist yet. Wait for that
    // move before walking on: otherwise all three presses land on the trigger and the walk never
    // starts. The presses after it are synchronous (the panel's own key handler).
    await app.keyboard.press('ArrowDown');
    await expect(app.getByRole('menu', { name: 'Main menu' }).getByRole('menuitem').first()).toBeFocused();
    await app.keyboard.press('ArrowDown');
    await app.keyboard.press('ArrowDown');
    await expect(byId(app, 'menu-settings')).toBeFocused();
    await app.keyboard.press('ArrowRight');
    await expect(app.getByRole('menu', { name: 'Settings' })).toBeVisible();
    await expect(app.getByRole('menuitem', { name: 'Print settings' })).toBeFocused();
    await app.keyboard.press('Enter');
    await expect.poll(() => read(app, (s) => s.view)).toBe('print');
  });

  test('the quick settings stay short and lead on to the full print settings', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.waitForTimeout(400);
    const link = byId(app, 'all-settings');
    await expect(link).toHaveText('All settings…');
    // the only link in the short list, so nothing else competes with it
    await expect(app.locator('[data-testid="quick-settings"] .link')).toHaveCount(1);
    await link.click();
    await expect.poll(() => read(app, (s) => s.view)).toBe('print');
  });
});
