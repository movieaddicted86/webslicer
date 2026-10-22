/**
 * A fresh page per spec: the app loaded, the fixture printer selected, the console watched.
 *
 * Every spec starts from the same state so a failure in one spec cannot cascade into the next through
 * a modified preset or a leftover object. The page fixture also fails a test on a browser console
 * error: an error the app logs is a defect the old `.claude` scripts reported as a check.
 */
import { test as base, expect } from '@playwright/test';
import { E2E_PRINTER } from '../global-setup';
import { openApp, settle } from './app';
import { installCanvasProbe, tapCamera } from './canvas';
import type { Page } from '@playwright/test';

/** Console errors the app logs on purpose (the autosave probe of a fresh browser has nothing to read). */
const EXPECTED = (text: string) => /Failed to load resource/.test(text) || /404 \(Not Found\)/.test(text);

export interface AppFixture {
  /** the loaded app, printer preset selected, canvas probe installed */
  app: Page;
  /** console and page errors collected so far (empty in a green run) */
  errors: string[];
}

async function prepare(page: Page): Promise<void> {
  await installCanvasProbe(page);
  await openApp(page);
  // a dialog of an earlier state or the Simple mode would hide controls the specs click
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    if (s.dialog) s.closeDialog();
    s.setMode('advanced');
    s.setView('plater');
  });
  // select the printer preset the fixture data installs
  await page.evaluate((name) => window.webslicer.getState().selectPreset('printer', name), E2E_PRINTER);
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.webslicer.getState().clearObjects());
  await page.waitForTimeout(800);
  await tapCamera(page);
  await settle(page, 400);
}

export const test = base.extend<AppFixture>({
  // eslint-disable-next-line no-empty-pattern -- the signature Playwright expects for a derived fixture
  errors: async ({}, use) => {
    await use([]);
  },
  app: async ({ page, errors }, use) => {
    page.on('pageerror', (e) => {
      if (!EXPECTED(e.message)) errors.push(`pageerror: ${e.message}`);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !EXPECTED(m.text())) errors.push(`console.error: ${m.text()}`);
    });
    await prepare(page);
    await use(page);
    expect(errors, 'no unexpected console errors').toEqual([]);
  },
});

export { expect };
