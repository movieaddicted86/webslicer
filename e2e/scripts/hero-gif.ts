/**
 * `npm run docs:gif` – records `docs/images/hero.gif`, the animation at the head of the README and of
 * `docs/features.md`: the empty plater, the library, a model, the slice, the preview with the layer
 * sweep and the send dialog.
 *
 * It runs against the same Docker image and fixture data as the E2E suite, with the mock print host of
 * `e2e/mock-host` on a private network – a real printer is never involved. Frames are screenshots
 * encoded with `gifenc`, so no extra tooling is needed.
 *
 * Environment:
 *   E2E_BASE_URL        an app that is already running, with E2E_MOCK_URL (default: start both)
 *   E2E_MOCK_URL        the mock host as the *app* sees it, e.g. `mock-host:8160`
 *   GIF_IMAGE           image tag, default `webslicer:e2e`
 *   GIF_SKIP_BUILD=1    reuse that image instead of building it
 *   GIF_OUT             output file, default `docs/images/hero.gif`
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, settle } from '../helpers/app';
import { E2E_PRINTER } from '../global-setup';
import { decodePng } from './png';

/** `gifenc` ships plain JavaScript; this is the part of its API the recorder uses. */
interface Gifenc {
  GIFEncoder: () => {
    writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: number[][]; delay: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize(data: Uint8Array, maxColors: number, opts: { format: 'rgb444' | 'rgb565' }): number[][];
  applyPalette(data: Uint8Array, palette: number[][], format: 'rgb444' | 'rgb565'): Uint8Array;
}

const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc') as Gifenc;

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.resolve(process.env.GIF_OUT || path.join(ROOT, 'docs', 'images', 'hero.gif'));
const IMAGE = process.env.GIF_IMAGE || 'webslicer:e2e';
const MOCK_IMAGE = process.env.GIF_MOCK_IMAGE || 'webslicer-mock-host:e2e';
const APP = 't083-hero-gif';
const MOCK = 't083-hero-mock';
const NETWORK = 't083-hero-net';
const MOCK_ALIAS = 'mock-host';
/** The port `e2e/mock-host` listens on – the same one `npm run e2e:docker` uses. */
const MOCK_PORT = 8160;
/** 1280 × 720: a desktop frame of the app, the size the README shows it at. */
const VIEWPORT = { width: 1280, height: 720 };
/** The one exception to the 300 KB image budget: the animation may reach this size. */
const MAX_BYTES = 4 * 1024 * 1024;

const log = (msg: string) => console.log(`[hero] ${msg}`);

/** One buffer out of several, without the spread of a `Buffer.concat` over many large arrays. */
function concat(parts: Uint8Array[]): Uint8Array {
  const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    all.set(part, at);
    at += part.length;
  }
  return all;
}

function docker(args: string[]): number {
  return spawnSync('docker', args, { stdio: 'inherit', cwd: ROOT }).status ?? 1;
}

const mount = (hostPath: string, target: string) =>
  (process.platform === 'win32' ? path.win32.normalize(hostPath) : hostPath) + `:${target}`;

async function freePort(): Promise<number> {
  for (let port = 8180; port < 8220; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => srv.close(() => resolve(true)));
      srv.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('no free port from 8180 on');
}

async function health(base: string): Promise<boolean> {
  try {
    return (await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

/** Start the app and the mock print host on a throwaway network, with a copy of the fixture data. */
async function startStack(): Promise<{ base: string; mock: string; tmp: string }> {
  if (!process.env.GIF_SKIP_BUILD) {
    log(`building ${IMAGE} …`);
    if (docker(['build', '-t', IMAGE, ROOT]) !== 0) throw new Error('docker build failed');
  }
  log(`building ${MOCK_IMAGE} …`);
  if (docker(['build', '-t', MOCK_IMAGE, path.join(ROOT, 'e2e', 'mock-host')]) !== 0)
    throw new Error('docker build of the mock host failed');
  if (docker(['network', 'create', NETWORK]) !== 0) throw new Error('docker network create failed');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-hero-'));
  const data = path.join(tmp, 'data');
  const library = path.join(tmp, 'library');
  const mockData = path.join(tmp, 'mock');
  fs.cpSync(path.join(ROOT, 'e2e', 'fixtures', 'data'), data, { recursive: true });
  fs.mkdirSync(library, { recursive: true });
  fs.mkdirSync(mockData, { recursive: true });

  const mockRun = [
    'run',
    '-d',
    '--name',
    MOCK,
    '--network',
    NETWORK,
    '--network-alias',
    MOCK_ALIAS,
    '-e',
    `MOCK_PORT=${MOCK_PORT}`,
    '-v',
    mount(mockData, '/mock-data'),
    MOCK_IMAGE,
  ];
  if (docker(mockRun) !== 0) throw new Error('docker run of the mock host failed');

  const port = await freePort();
  log(`starting ${APP} on port ${port} …`);
  const started = docker([
    'run',
    '-d',
    '--name',
    APP,
    '--network',
    NETWORK,
    '-p',
    `127.0.0.1:${port}:8080`,
    '-v',
    mount(data, '/data'),
    '-v',
    mount(library, '/library'),
    '-e',
    'WEBSLICER_UPDATE_CHECK=off',
    IMAGE,
  ]);
  if (started !== 0) throw new Error('docker run failed');

  // the container publishes on the loopback address only, and `localhost` may resolve to ::1 first
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) {
    if (await health(base)) return { base, mock: `${MOCK_ALIAS}:${MOCK_PORT}`, tmp };
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${base}/api/health did not answer`);
}

function stopStack(): void {
  docker(['rm', '-f', APP]);
  docker(['rm', '-f', MOCK]);
  docker(['network', 'rm', NETWORK]);
}

class Recorder {
  /** `rgba`, 4 bytes per pixel – what `gifenc` reads */
  private readonly frames: { rgba: Uint8Array; delay: number }[] = [];

  constructor(private readonly page: Page) {}

  /** One screenshot as a frame; `delay` is how long it stays on screen, in milliseconds. */
  async frame(delay: number): Promise<void> {
    const png = await this.page.screenshot({ animations: 'disabled' });
    const img = decodePng(png);
    // `gifenc` reads RGBA; the PNG decoder hands out RGB without an alpha channel
    const rgba = new Uint8Array(img.width * img.height * 4);
    for (let i = 0; i < img.width * img.height; i++) {
      rgba[i * 4] = img.rgb[i * 3];
      rgba[i * 4 + 1] = img.rgb[i * 3 + 1];
      rgba[i * 4 + 2] = img.rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
    this.frames.push({ rgba, delay });
  }

  /** Encode every frame into one GIF; a file above the budget fails instead of landing in the docs. */
  write(file: string): void {
    if (!this.frames.length) throw new Error('no frames recorded');
    // One palette for the whole animation, so colours do not shift from frame to frame. It is built
    // from every third pixel of every frame – enough for a stable palette, little enough to stay fast.
    const samples: Uint8Array[] = [];
    for (const frame of this.frames) {
      const pixels = frame.rgba.length / 4;
      const sample = new Uint8Array(Math.ceil(pixels / 3) * 4);
      for (let i = 0, out = 0; i < pixels; i += 3, out += 4) {
        const at = i * 4;
        sample[out] = frame.rgba[at];
        sample[out + 1] = frame.rgba[at + 1];
        sample[out + 2] = frame.rgba[at + 2];
        sample[out + 3] = 255;
      }
      samples.push(sample);
    }
    const palette = quantize(concat(samples), 256, { format: 'rgb565' });
    const gif = GIFEncoder();
    for (const frame of this.frames) {
      const index = applyPalette(frame.rgba, palette, 'rgb565');
      gif.writeFrame(index, VIEWPORT.width, VIEWPORT.height, { palette, delay: frame.delay });
    }
    gif.finish();
    const bytes = Buffer.from(gif.bytes());
    if (bytes.length > MAX_BYTES) {
      throw new Error(`the GIF is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, over the 4 MB budget – record fewer or shorter frames`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    const seconds = this.frames.reduce((sum, frame) => sum + frame.delay, 0) / 1000;
    log(
      `${this.frames.length} frames, ${seconds.toFixed(1)} s, ${VIEWPORT.width}×${VIEWPORT.height}, ${(bytes.length / 1024).toFixed(0)} KB → ${file}`,
    );
  }
}

/** Blur the focused control, zoom to the selection and back off a little so the model has room. */
async function fit(page: Page, back = 1400): Promise<void> {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press('z');
  await page.waitForTimeout(700);
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, back);
  await page.waitForTimeout(700);
}

/** The page state every recording starts from: the fixture printer, Advanced mode, plater, no dialog. */
async function prepare(page: Page, mock: string): Promise<void> {
  await openApp(page);
  await page.evaluate(async (name) => {
    const s = window.webslicer.getState();
    if (s.dialog) s.closeDialog();
    s.setMode('advanced');
    s.setView('plater');
    await s.selectPreset('printer', name);
  }, E2E_PRINTER);
  await page.waitForTimeout(2500);
  // the host of the send step – the mock print host, never a real printer
  await page.evaluate(
    async ({ host, presetName }) => {
      await fetch('/api/printers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Workshop MK3S', type: 'moonraker', host, presetName }),
      });
      await window.webslicer.getState().refreshPhysicalPrinters();
    },
    { host: mock, presetName: E2E_PRINTER },
  );
  await page.waitForTimeout(800);
}

/** library → model → slice → preview with the layer sweep → send dialog. */
async function record(page: Page, rec: Recorder): Promise<void> {
  // 1) the empty plater
  await rec.frame(900);

  // 2) the library dialog, the sample folder, the model
  await page.evaluate(() => window.webslicer.getState().openDialog('library', 'open'));
  await page.waitForTimeout(1000);
  await rec.frame(1000);
  await page.locator('.name', { hasText: 'samples' }).first().click();
  await page.waitForTimeout(900);
  await rec.frame(900);
  await page.locator('.name', { hasText: 'cylinder_with_cube.stl' }).first().click();
  await page.waitForTimeout(2500);
  await settle(page, 1200);
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    s.select([s.objects[0].id]);
  });
  await fit(page, 450);
  await rec.frame(1100);

  // 3) slice: two progress frames, then the result
  const before = await page.evaluate(() => window.webslicer.getState().job?.id);
  await page.locator('[data-testid="slice-button"]').click();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(350);
    const job = await page.evaluate(() => ({ id: window.webslicer.getState().job?.id, status: window.webslicer.getState().job?.status }));
    // forty progress frames would be a slideshow of one status bar: two of them carry the moment
    if (i === 1 || i === 3) await rec.frame(300);
    if (job.status === 'done' && job.id !== before) break;
  }

  // 4) the preview, then the layer sweep up and back down
  await page.evaluate(() => window.webslicer.getState().setView('preview'));
  await settle(page, 3000);
  await page.evaluate(() => {
    const s = window.webslicer.getState();
    s.setPreviewLayerRange([0, s.gcode?.layerCount ?? 40]);
    s.select([]);
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.locator('.viewer-toolbar button', { hasText: 'Iso' }).first().click();
  await page.waitForTimeout(1600);
  // the preview does not frame the toolpaths: pan the model to the middle (right drag), then zoom in
  await page.mouse.move(900, 430);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(780, 425, { steps: 6 });
  await page.mouse.move(640, 420, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(500);
  await page.mouse.move(640, 420);
  await page.mouse.wheel(0, -700);
  await page.waitForTimeout(1200);
  const layers = await page.evaluate(() => window.webslicer.getState().gcode?.layerCount ?? 40);
  await rec.frame(600);
  const setTop = (top: number) =>
    page.evaluate((t) => window.webslicer.getState().setPreviewLayerRange([0, t]), Math.max(1, Math.round(top)));
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    await setTop((layers * (steps - i)) / steps);
    await page.waitForTimeout(250);
    await rec.frame(130);
  }
  for (let i = steps - 1; i >= 0; i--) {
    await setTop((layers * (steps - i)) / steps);
    await page.waitForTimeout(200);
    await rec.frame(110);
  }
  await setTop(layers);
  await page.waitForTimeout(700);
  await rec.frame(900);

  // 5) the send dialog and the upload to the mock
  await page.locator('[data-testid="send-button"]').click();
  await page.waitForTimeout(900);
  await rec.frame(1500);
  await page.locator('[data-testid="modal-primary"]').click();
  await page.waitForTimeout(1200);
  await rec.frame(2200);
}

/** Only a stack this run started is torn down again – never one that `E2E_BASE_URL` points at. */
let owned: { tmp: string } | undefined;

async function main(): Promise<void> {
  const started = process.env.E2E_BASE_URL ? undefined : await startStack();
  owned = started;
  const base = process.env.E2E_BASE_URL ?? started?.base;
  const mock = process.env.E2E_MOCK_URL ?? started?.mock;
  if (!base) throw new Error('no app: set E2E_BASE_URL or let the script start one');
  if (!mock) throw new Error('no mock print host: set E2E_MOCK_URL (the send step needs it)');
  log(`recording from ${base} …`);
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL: base });
    const page = await context.newPage();
    const rec = new Recorder(page);
    await prepare(page, mock);
    await record(page, rec);
    rec.write(OUT);
    await context.close();
  } finally {
    await browser.close();
    cleanup();
  }
}

function cleanup(): void {
  if (!owned) return;
  stopStack();
  fs.rmSync(owned.tmp, { recursive: true, force: true });
  owned = undefined;
}

main().catch((e: unknown) => {
  console.error(`[hero] ${(e as Error).message}`);
  cleanup();
  process.exitCode = 1;
});
