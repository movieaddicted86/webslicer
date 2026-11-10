/**
 * The close-up ribbons (T-098): the sliced result stays visible at every zoom, on a device whose
 * texture width is smaller than the segment count, and it comes back after a re-slice or a return to
 * the Preview.
 *
 * T-094 stored every segment in a texture row as wide as the segment count. A real model exceeds
 * `MAX_TEXTURE_SIZE`, the texture is invalid, `texelFetch` returns zeros and every ribbon collapses –
 * so a phone showed an empty Preview exactly where the renderer switched from hairlines to ribbons.
 * The layout now wraps the run into rows, and a device that cannot hold it keeps the hairlines.
 *
 * The drawn toolpaths are counted in canvas pixels (`shot`: `brightCount`, the bright chromatic
 * toolpath colours; the plate, the bed and the UI carry none of them) and in the ribbon instance
 * window (`gcodeScene`: `ribbonRange`), never judged by eye.
 */
import { CUBE, read, settle, sliceAndWait, waitReady } from '../helpers/app';
import type { Page } from '@playwright/test';
import { frameProbe, gcodeScene, shot, tapCamera } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';

/**
 * A texture width far below the cube's segment count (13k segments need 26k texels), so the segment
 * run does not fit a row and the layout has to wrap into rows that still fit the device.
 */
const SMALL_LIMIT = 256;
/** Bright toolpath pixels a drawn close-up leaves on the canvas; the collapsed renderer left ~1.7k. */
const DRAWN_FLOOR = 20_000;

let cubeJob = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  cubeJob = await sliceOnce(browser);
});

/** Load `url`, open the shared cube slice and show the Preview. */
async function openPreview(app: Page, url: string): Promise<void> {
  await app.goto(url, { waitUntil: 'networkidle' });
  await waitReady(app);
  await tapCamera(app);
  await openSharedSlice(app, cubeJob, CUBE);
  await app.evaluate(() => window.webslicer.getState().setView('preview'));
  await settle(app, 1500);
}

/** One wheel notch into the scene, centred on the canvas. */
async function wheelIn(app: Page): Promise<void> {
  const box = (await app.locator('.viewer canvas').boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await app.mouse.wheel(0, -900);
  await app.waitForTimeout(400);
}

/** Zoom in until the adaptive renderer switches to the close-up ribbons. */
async function zoomUntilRibbons(app: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await wheelIn(app);
        return (await gcodeScene(app)).wide;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await app.waitForTimeout(1000);
}

/** Zoom in a fixed number of notches, for a page where the ribbons never come (the fallback). */
async function zoomSteps(app: Page, steps: number): Promise<void> {
  for (let i = 0; i < steps; i++) await wheelIn(app);
  await app.waitForTimeout(1000);
}

/** The texture size of each ribbon sampler, so "the layout wrapped" is an observable. */
async function ribbonTextures(app: Page): Promise<Record<string, { w: number; h: number }>> {
  return app.evaluate(() => {
    const out: Record<string, { w: number; h: number }> = {};
    window.__wsScene().traverse((o) => {
      if (!o.isMesh || !o.geometry?.isInstancedBufferGeometry) return;
      const material = (Array.isArray(o.material) ? o.material[0] : o.material) as
        { uniforms?: Record<string, { value: { image?: { width: number; height: number } } }> } | undefined;
      for (const [name, uniform] of Object.entries(material?.uniforms ?? {})) {
        const image = (uniform.value as { image?: { width: number; height: number } }).image;
        if (image) out[name] = { w: image.width, h: image.height };
      }
    });
    return out;
  });
}

test.describe('preview: ribbons at close zoom (T-098)', () => {
  test('a segment count above the texture width still draws, and the layer window still cuts it', async ({ app }) => {
    // AC-2: the hook lowers the width the way a phone's GPU does, so the cube has to wrap
    await openPreview(app, `/?testRibbonLimit=${SMALL_LIMIT}`);
    const segments = (await gcodeScene(app)).segs;
    expect(segments).toBeGreaterThan(SMALL_LIMIT);

    await zoomUntilRibbons(app);
    expect((await gcodeScene(app)).wide, 'the close-up uses the ribbons').toBe(true);
    // the whole run is addressable, wrapped into rows that fit the lowered limit
    const textures = await ribbonTextures(app);
    for (const [name, size] of Object.entries(textures)) {
      expect(size.w, `${name} fits the texture width`).toBeLessThanOrEqual(SMALL_LIMIT);
      expect(size.h, `${name} fits the device height`).toBeLessThanOrEqual(8192);
    }
    expect(
      Object.values(textures).some((s) => s.h > 1),
      'the segment run wrapped into rows',
    ).toBe(true);

    const drawn = await shot(app);
    expect(drawn.brightCount, 'the close-up draws its toolpaths').toBeGreaterThan(DRAWN_FLOOR);

    // the layer window still cuts the wrapped run: one layer keeps only its own segments
    const layers = await read(app, (s) => s.gcode!.layerCount);
    const expected = await app.evaluate(
      ([lo, hi]) => {
        const g = window.webslicer.getState().gcode!;
        return [g.layerStart[lo], g.layerStart[hi + 1] - g.layerStart[lo]];
      },
      [0, 0] as const,
    );
    await app.evaluate(() => window.webslicer.getState().setPreviewLayerRange([0, 0]));
    await app.waitForTimeout(1200);
    const oneLayer = await gcodeScene(app);
    expect(oneLayer.ribbonRange).toEqual(expected);
    expect(oneLayer.segs, 'the cut window is shorter than the whole run').toBeLessThan(segments);
    const cut = await shot(app);
    expect(cut.brightCount, 'the cut window draws fewer toolpaths').toBeLessThan(drawn.brightCount);

    await app.evaluate((top) => window.webslicer.getState().setPreviewLayerRange([0, top]), layers - 1);
    await app.waitForTimeout(1200);
    expect((await gcodeScene(app)).ribbonRange, 'the full window is back').toEqual([0, segments]);
    expect((await shot(app)).brightCount, 'the whole close-up is drawn again').toBeGreaterThan(drawn.brightCount * 0.5);
  });

  test('a re-slice and a return to the Preview show the toolpaths again (R-07)', async ({ app }) => {
    // AC-3: the cube's real segment count already wraps on a device limit of 8192 (26k texels)
    await openPreview(app, '/');
    const before = await gcodeScene(app);
    expect(before.segs).toBeGreaterThan(0);
    await zoomUntilRibbons(app);
    expect((await gcodeScene(app)).wide).toBe(true);
    expect((await shot(app)).brightCount).toBeGreaterThan(DRAWN_FLOOR);

    const job = await read(app, (s) => s.job?.id);
    // a re-slice replaces the result, so the old ribbons' textures and geometry go and new ones come
    await sliceAndWait(app, job);
    await settle(app, 2500);
    const resliced = await gcodeScene(app);
    expect(resliced.segs).toBeGreaterThan(0);
    expect(resliced.wide, 'the new result is still in the close-up ribbons').toBe(true);
    expect((await shot(app)).brightCount, 'the re-sliced result is drawn').toBeGreaterThan(DRAWN_FLOOR);

    // leaving the Preview and coming back rebuilds the group: the toolpaths are drawn again
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await settle(app, 1000);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1500);
    const reentered = await gcodeScene(app);
    expect(reentered.segs).toBe(resliced.segs);
    expect(reentered.wide).toBe(true);
    expect((await shot(app)).brightCount, 'the returning Preview is drawn').toBeGreaterThan(DRAWN_FLOOR);
  });

  test('without the ribbons the close-up keeps its hairlines, never an empty scene', async ({ app }) => {
    // AC-4: the renderer unavailable (a phone without float textures) falls back to the hairlines
    await openPreview(app, '/?testRibbons=off');
    const before = await gcodeScene(app);
    expect(before.segs).toBeGreaterThan(0);
    expect(before.wide).toBe(false);
    const startPixels = (await shot(app)).brightCount;

    // the gesture really zooms: the bed's projected span grows, the same measure the camera spec uses
    const home = await frameProbe(app);
    await zoomSteps(app, 6);
    const zoomed = await frameProbe(app);
    const span = (f: typeof home) => (f.bed ? Math.max(Math.abs(f.bed[2] - f.bed[0]), Math.abs(f.bed[3] - f.bed[1])) : 0);
    expect(span(zoomed), 'the close-up zoomed in').toBeGreaterThan(span(home) * 1.5);

    const close = await gcodeScene(app);
    expect(close.segs, 'the hairlines keep drawing the whole range').toBe(before.segs);
    expect(close.wide, 'no ribbon mesh took over').toBe(false);
    expect((await shot(app)).brightCount, 'the close-up still draws toolpaths').toBeGreaterThan(0);
    expect(startPixels, 'the far view draws toolpaths too').toBeGreaterThan(0);
  });
});
