/**
 * Compare the adaptive toolpaths with the old hairlines in the same browser session. An absolute
 * millisecond budget would benchmark the CI host rather than the renderer (especially SwiftShader).
 */
import type { Page } from '@playwright/test';
import { SPHERE, waitReady } from '../helpers/app';
import { gcodeScene, tapCamera } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';

const FRAME_RATIO_BUDGET = 2.5;

interface FrameTiming {
  median: number;
  p95: number;
}

async function measureFrames(page: Page): Promise<FrameTiming> {
  // warm the shader and the large instance buffers before measuring
  await page.waitForTimeout(1500);
  return page.evaluate(async () => {
    const frames: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 90; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const now = performance.now();
      if (i >= 30) frames.push(now - previous);
      previous = now;
    }
    frames.sort((a, b) => a - b);
    return { median: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)] };
  });
}

test('adaptive toolpaths stay close to the hairline baseline on the largest sample', async ({ app, browser }) => {
  const job = await sliceOnce(browser, SPHERE);
  await app.goto('/?testToolpaths=hairlines', { waitUntil: 'networkidle' });
  await waitReady(app);
  await tapCamera(app);
  await openSharedSlice(app, job, SPHERE);
  const segments = (await gcodeScene(app)).segs;
  expect(segments).toBeGreaterThan(1000);
  expect((await gcodeScene(app)).wide).toBe(false);
  const baseline = await measureFrames(app);

  await app.goto('/', { waitUntil: 'networkidle' });
  await waitReady(app);
  await tapCamera(app);
  await openSharedSlice(app, job, SPHERE);
  expect((await gcodeScene(app)).segs).toBe(segments);
  expect((await gcodeScene(app)).wide).toBe(false);
  const adaptive = await measureFrames(app);
  const ratio = adaptive.p95 / baseline.p95;
  console.log(
    `Large-sample toolpaths: ${segments} segments; hairlines median ${baseline.median.toFixed(1)} ms, p95 ${baseline.p95.toFixed(1)} ms; adaptive median ${adaptive.median.toFixed(1)} ms, p95 ${adaptive.p95.toFixed(1)} ms; p95 ratio ${ratio.toFixed(2)}x, budget ${FRAME_RATIO_BUDGET}x`,
  );
  expect(ratio).toBeLessThanOrEqual(FRAME_RATIO_BUDGET);
  await app.mouse.move(600, 400);
  await app.mouse.down();
  await app.mouse.move(660, 440, { steps: 6 });
  await app.mouse.up();
  expect((await gcodeScene(app)).segs).toBe(segments);
  await expect
    .poll(
      async () => {
        await app.mouse.wheel(0, -900);
        await app.waitForTimeout(1000);
        return (await gcodeScene(app)).wide;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
});
