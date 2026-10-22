/**
 * The end-to-end suite (T-030): the browser checks that used to live in git-ignored
 * `.claude/t1x-browser.mjs` scripts, ported to `@playwright/test` so they run from the repository
 * and in CI.
 *
 * The suite always talks to a **running** app (`E2E_BASE_URL`, default `http://localhost:8080`).
 * `npm run e2e:docker` builds the image, starts it with the fixture data dir and sets the base URL;
 * against a hand-started server the fixture data has to be in place (the global setup checks that and
 * says so).
 *
 * Specs share one plater and one slice queue, so they run one after the other in a single worker.
 * `retries` stays 0: a flaky test has to show up as a failure (AC-5), not be hidden by a retry.
 */
import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e/specs',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
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
