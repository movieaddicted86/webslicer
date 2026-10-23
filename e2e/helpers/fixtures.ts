/**
 * A fresh page per spec: the app loaded, the fixture printer selected, the console watched.
 *
 * Every spec starts from the same state so a failure in one spec cannot cascade into the next through
 * a modified preset or a leftover object. The page fixture also fails a test on a browser console
 * error: an error the app logs is a defect the old `.claude` scripts reported as a check.
 */
import { test as base, expect } from '@playwright/test';
import { E2E_PRINTER } from '../global-setup';
import { CUBE, importFile, openApp, openSlicedJob, read, settle, sliceAndWait } from './app';
import { installCanvasProbe, tapCamera } from './canvas';
import type { Browser, Page } from '@playwright/test';

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

/**
 * One slice per spec instead of one per test (T-057): a spec whose tests only *read* the sliced
 * result slices once in `beforeAll` and every test loads that job with `openSlicedJob`. The job
 * lives on the server, so the page that sliced it can be closed. Keyed by the model, and memoised for
 * the worker: all tests of a file run in one worker (`fullyParallel: false`), so the beforeAll of a
 * file slices exactly once.
 */
const sharedJobs = new Map<string, Promise<string>>();

export function sliceOnce(browser: Browser, file: string = CUBE): Promise<string> {
  let pending = sharedJobs.get(file);
  if (!pending) {
    pending = sliceShared(browser, file);
    sharedJobs.set(file, pending);
  }
  return pending;
}

/**
 * The fast profile of the shared slice (T-057): a coarser layer height and faster speeds. No assertion
 * of the sharing specs depends on print quality – they read layer counts, ranges, markers and stats,
 * all of which follow the G-code that a coarser profile still produces. Fill, solid layers and skirt
 * stay at the fixture's values: the preview's feature-visibility test needs the full feature set.
 */
export const FAST_PROFILE: Record<string, string> = {
  layer_height: '0.3',
  print_speed: '120',
  perimeter_speed: '100',
  infill_speed: '150',
  travel_speed: '300',
};

async function sliceShared(browser: Browser, file: string): Promise<string> {
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL });
  const page = await context.newPage();
  try {
    await openApp(page);
    await page.evaluate((name) => window.webslicer.getState().selectPreset('printer', name), E2E_PRINTER);
    await page.waitForTimeout(2500);
    await page.evaluate((profile) => {
      const s = window.webslicer.getState();
      for (const [key, value] of Object.entries(profile)) s.setOption('print', key, value);
    }, FAST_PROFILE);
    await importFile(page, file);
    await sliceAndWait(page);
    const jobId = await read(page, (s) => s.job?.id ?? '');
    if (!jobId) throw new Error('the shared slice produced no job');
    return jobId;
  } finally {
    await context.close();
  }
}

/** A per-test page on a job another page sliced: the model in the plater, the job and its toolpaths. */
export async function openSharedSlice(page: Page, jobId: string, file: string = CUBE): Promise<void> {
  await importFile(page, file);
  await openSlicedJob(page, jobId);
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
