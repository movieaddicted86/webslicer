/**
 * The end-to-end suite (T-030): the browser checks that used to live in git-ignored
 * `.claude/t1x-browser.mjs` scripts, ported to `@playwright/test` so they run from the repository
 * and in CI.
 *
 * The suite always talks to a **running** app and has **no default target**: without `E2E_BASE_URL`
 * the global setup stops with a message. A default of `localhost:8080` is exactly where a developer's
 * own compose stack runs, and this suite deletes jobs and writes presets – it may only ever see a
 * fixture instance (the global setup checks the fixture marker before its first write).
 * `npm run e2e:docker` builds the image, starts it with a copy of `e2e/fixtures/data` and sets the
 * base URL; CI does the same.
 *
 * Every test gets its own browser context, printer preset and autosave id, so files are independent of
 * each other and two workers can run at once (T-057, CI only – one worker locally keeps the local
 * machine's slice queue and the Docker instance's CPU free). Tests inside a file stay serial
 * (`fullyParallel: false`): they share one plater. The few tests that read or write server state the
 * others also see – the printer list, the mock host's upload log – take the `server-state` test lock.
 * `retries` stays 0: a flaky test has to show up as a failure (AC-5), not be hidden by a retry.
 */
import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // T-057: CI runs two workers per shard; the flag there decides, this is the local default
  workers: process.env.CI ? 2 : 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // one slice on the software rasterizer is slow; a spec that hangs must fail, not block the run
  timeout: 420_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
    // headless Chromium falls back to SwiftShader for WebGL; older builds need this switch
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
