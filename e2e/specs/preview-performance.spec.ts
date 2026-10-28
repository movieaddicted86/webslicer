/**
 * The visible-width toolpaths on the largest bundled sample. Software WebGL is slower than a real GPU,
 * so the generous budget catches a runaway per-segment cost without making the CI host a benchmark.
 */
import { SPHERE } from '../helpers/app';
import { gcodeScene } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';

const FRAME_BUDGET_MS = 200;

test('the largest sample stays interactive with world-width toolpaths', async ({ app, browser }) => {
  const job = await sliceOnce(browser, SPHERE);
  await openSharedSlice(app, job, SPHERE);
  const segments = (await gcodeScene(app)).segs;
  expect(segments).toBeGreaterThan(1000);
  expect((await gcodeScene(app)).wide).toBe(false);
  // warm the shader and the large instance buffers before measuring
  await app.waitForTimeout(1500);
  const timing = await app.evaluate(async () => {
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
  console.log(
    `Large-sample toolpaths: ${segments} segments; frame median ${timing.median.toFixed(1)} ms, p95 ${timing.p95.toFixed(1)} ms; budget ${FRAME_BUDGET_MS} ms`,
  );
  expect(timing.p95).toBeLessThan(FRAME_BUDGET_MS);
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
