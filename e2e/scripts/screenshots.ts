/**
 * `npm run docs:screenshots` – the images in `docs/images/`, captured from the real app.
 *
 * Every screenshot is generated so it can be refreshed after a UI change instead of being retaken by
 * hand. The script runs against a Docker instance (the same image and fixture data the E2E suite
 * uses) unless `E2E_BASE_URL` points at one that is already running, loads the bundled sample models
 * and captures at a fixed 1440 × 900 viewport. The app's theme is dark, which is the only one it has.
 *
 * Environment:
 *   E2E_BASE_URL      an already running app; without it the script starts `t056-screenshots`
 *   DOCS_IMAGE        image tag to start, default `webslicer:e2e`
 *   DOCS_SKIP_BUILD=1 reuse the image instead of building it
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { CUBE, PAIR, importFile, openApp, settle, sliceAndWait } from '../helpers/app';
import { E2E_PRINTER } from '../global-setup';
import { decodePng, encodeIndexedPng } from './png';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');
const IMAGE = process.env.DOCS_IMAGE || 'webslicer:e2e';
const CONTAINER = 't056-screenshots';
const VIEWPORT = { width: 1440, height: 900 };
/** The docs budget: a screenshot bigger than this is a screenshot that was not clipped enough. */
const MAX_BYTES = 300 * 1024;

const log = (msg: string) => console.log(`[screenshots] ${msg}`);

function docker(args: string[]): number {
  return spawnSync('docker', args, { stdio: 'inherit', cwd: ROOT }).status ?? 1;
}

const mount = (hostPath: string, target: string) =>
  (process.platform === 'win32' ? path.win32.normalize(hostPath) : hostPath) + `:${target}`;

async function freePort(): Promise<number> {
  for (let port = 8080; port < 8120; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('no free port from 8080 on');
}

async function health(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** Start the app from the image with a throwaway copy of the fixture data; returns its base URL. */
async function startApp(): Promise<{ base: string; tmp: string }> {
  if (!process.env.DOCS_SKIP_BUILD) {
    log(`building ${IMAGE} …`);
    if (docker(['build', '-t', IMAGE, ROOT]) !== 0) throw new Error('docker build failed');
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-docs-'));
  const data = path.join(tmp, 'data');
  const library = path.join(tmp, 'library');
  fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'data'), data, { recursive: true });
  fs.mkdirSync(library, { recursive: true });

  const port = await freePort();
  log(`starting ${CONTAINER} on port ${port} …`);
  const started = docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-p',
    `127.0.0.1:${port}:8080`,
    '-v',
    mount(data, '/data'),
    '-v',
    mount(library, '/library'),
    IMAGE,
  ]);
  if (started !== 0) throw new Error('docker run failed');

  // the container publishes on the loopback address only, and `localhost` may resolve to ::1 first
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (await health(base)) return { base, tmp };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${base}/api/health did not answer`);
}

/** The page state every shot starts from: the fixture printer, Advanced mode, no dialog, plater view. */
async function prepare(page: Page): Promise<void> {
  await openApp(page);
  await page.evaluate(async (name) => {
    const s = window.webslicer.getState();
    if (s.dialog) s.closeDialog();
    s.setMode('advanced');
    s.setView('plater');
    await s.selectPreset('printer', name);
  }, E2E_PRINTER);
  await page.waitForTimeout(2500);
}

async function shot(page: Page, name: string, what: string): Promise<void> {
  const file = path.join(OUT, `${name}.png`);
  const raw = await page.screenshot({ animations: 'disabled' });
  // indexed PNG: the same picture at about a quarter of Playwright's true-colour size
  fs.writeFileSync(file, encodeIndexedPng(decodePng(raw)));
  const bytes = fs.statSync(file).size;
  const kb = Math.round(bytes / 1024);
  if (bytes > MAX_BYTES) log(`WARNING ${name}.png is ${kb} KB (budget ${MAX_BYTES / 1024} KB)`);
  else log(`${name}.png – ${what} (${kb} KB)`);
}

/**
 * Frame the model: the app starts on the whole bed, so the shot presses Z (zoom to selection) and
 * backs off with wheel notches – close enough to see the object, wide enough to see its surroundings.
 */
async function fitView(page: Page, backOff = 1600): Promise<void> {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('z');
  await page.waitForTimeout(900);
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // wheel down = zoom out in the viewer's orbit controls
  await page.mouse.wheel(0, backOff);
  await page.waitForTimeout(900);
}

/** The plater with one cube and the tool strip above the scene. */
async function platerShot(page: Page): Promise<void> {
  await prepare(page);
  await importFile(page, CUBE);
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    s.select([s.objects[0].id]);
  });
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    s.setOption('print', 'skirts', '1');
    s.setOption('print', 'brim_type', 'outer_only');
  });
  await settle(page, 1200);
  await fitView(page, 2000);
  await shot(page, 'plater', 'the plater, the object list and the tool strip');
}

/** The cut tool's controls in the context panel, with the primary action and the key hints. */
async function cutShot(page: Page): Promise<void> {
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    s.select([s.objects[0].id]);
    s.openTool('cut');
  });
  await settle(page, 900);
  await shot(page, 'cut-tool', 'the cut tool panel');
  await page.evaluate(() => window.webslicer.getState().closeTool());
}

/** Print settings in Advanced mode: tabs, pages, groups and the mode switch. */
async function settingsShot(page: Page): Promise<void> {
  await page.evaluate(() => window.webslicer.getState().setView('print'));
  await settle(page, 900);
  await shot(page, 'settings', 'Print Settings in Advanced mode');
}

/** The preview of a real slice: toolpaths, legend, layer slider and the layer codes. */
async function previewShot(page: Page): Promise<void> {
  await page.evaluate(() => window.webslicer.getState().setView('plater'));
  await sliceAndWait(page);
  await page.evaluate(() => window.webslicer.getState().setView('preview'));
  await page.evaluate(() =>
    window.webslicer.getState().setPreviewLayerRange([0, Math.floor((window.webslicer.getState().gcode?.layerCount ?? 10) / 2)]),
  );
  await page.evaluate(() => window.webslicer.getState().togglePreviewMarker('seam'));
  await settle(page, 2000);
  await fitView(page, 1200);
  await shot(page, 'preview', 'the G-code preview with the legend and the layer slider');
}

/**
 * The file library with the sample models the image seeds, and a selection of two files: the
 * checkboxes and the action bar (Load all / Delete selected / Clear) only appear once something is
 * selected, so a shot of the resting list would not show a reader what the library can do (T-077).
 */
async function libraryShot(page: Page): Promise<void> {
  await page.evaluate(() => window.webslicer.getState().setView('plater'));
  await page.evaluate(() => window.webslicer.getState().openDialog('library', 'open'));
  await page.waitForTimeout(1200);
  // the samples folder holds the files; open it and tick the first two
  await page.locator('[data-testid="library-row"]').filter({ hasText: 'samples' }).first().locator('.name').click();
  await page.waitForTimeout(900);
  const picks = page.locator('[data-testid="library-check"]');
  await picks.nth(0).check();
  await picks.nth(1).check();
  await page.waitForTimeout(600);
  await shot(page, 'library', 'the file library with a two-file selection');
  await page.evaluate(() => window.webslicer.getState().closeDialog());
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  let started: { base: string; tmp: string } | undefined;
  if (!process.env.E2E_BASE_URL) started = await startApp();
  const base = process.env.E2E_BASE_URL ?? started?.base;
  if (!base) throw new Error('no app: neither E2E_BASE_URL nor a started container');
  log(`capturing from ${base}`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL: base });
    const page = await context.newPage();
    await platerShot(page);
    await cutShot(page);
    await settingsShot(page);
    await previewShot(page);
    await libraryShot(page);
    await context.close();

    // a second model with two objects makes the plater look less empty for the hero image
    const hero = await browser.newContext({ viewport: VIEWPORT, baseURL: base });
    const heroPage = await hero.newPage();
    await prepare(heroPage);
    await importFile(heroPage, PAIR);
    await importFile(heroPage, CUBE, { clear: false });
    await heroPage.evaluate(() => window.webslicer.getState().arrange());
    await settle(heroPage, 1400);
    await heroPage.evaluate(() => {
      const s = window.webslicer.getState();
      s.select(s.objects.map((o) => o.id));
    });
    await fitView(heroPage, 2400);
    await shot(heroPage, 'hero', 'the hero image: two models on the plater');
    await hero.close();
  } finally {
    await browser.close();
    docker(['rm', '-f', CONTAINER]);
    if (started) fs.rmSync(started.tmp, { recursive: true, force: true });
  }
}

main().catch((e: unknown) => {
  console.error(`[screenshots] ${(e as Error).message}`);
  docker(['rm', '-f', CONTAINER]);
  process.exitCode = 1;
});
