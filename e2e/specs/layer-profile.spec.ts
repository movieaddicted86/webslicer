/**
 * T-045: the variable layer height profile.
 *
 * AC-1 is the whole path: a 30 mm sphere gets an adaptive profile at the finest quality, and the real
 * CLI then slices it into more layers than the fixed 0.2 mm profile – with thin layers at the poles and
 * thick ones at the equator, both in the profile and in the G-code's layer heights. The second test
 * covers Reset and undo: one Ctrl+Z removes a profile the Adaptive button created, Reset does the same
 * in one click.
 */
import { SPHERE, importFile, press, read, settle, sliceAndWait, state } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/** Average profile layer height in three Z bands of the 30 mm sphere. */
async function profileBands(app: Parameters<typeof read>[0]) {
  return read(app, (s) => {
    const p = s.objects[0].layerProfile || [];
    const acc: Record<'bottom' | 'middle' | 'top', [number, number]> = {
      bottom: [0, 0],
      middle: [0, 0],
      top: [0, 0],
    };
    for (let i = 0; i + 1 < p.length; i += 2) {
      const z = p[i];
      const h = p[i + 1];
      const band = z < 5 ? acc.bottom : z > 25 ? acc.top : z > 13 && z < 17 ? acc.middle : undefined;
      if (band) {
        band[0] += h;
        band[1] += 1;
      }
    }
    const avg = (a: [number, number]) => (a[1] ? a[0] / a[1] : 0);
    return { bottom: avg(acc.bottom), middle: avg(acc.middle), top: avg(acc.top) };
  });
}

/** The layer heights of the loaded G-code: consecutive differences of its layer Z values. */
async function gcodeGaps(app: Parameters<typeof read>[0]) {
  return read(app, (s) => {
    const zs = s.gcode?.layerZ || [];
    const gaps: number[] = [];
    for (let i = 1; i < zs.length; i++) {
      const d = +(zs[i] - zs[i - 1]).toFixed(4);
      // the start G-code moves to the first layer's Z before the first ;LAYER_CHANGE, so the parser
      // sees that layer twice (gap 0); only real layer steps count
      if (d > 0.001) gaps.push(d);
    }
    return { count: s.gcode?.layerCount || 0, gaps };
  });
}

test.describe('variable layer height', () => {
  test('adaptive on a sphere: thin at the poles, thick at the equator, more layers than 0.2 mm', async ({ app }) => {
    await importFile(app, SPHERE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setOption('print', 'layer_height', '0.2');
      s.select([s.objects[0].id]);
      // T-046: the profile panel is a tool panel now – it opens from the left bar or with V
      s.openTool('layerHeight');
    });
    await settle(app, 600);
    await expect(app.locator('.tool-panel')).toBeVisible();
    await expect(app.locator('.layer-profile-chart')).toBeVisible();

    // the reference: the sphere with its fixed 0.2 mm layers
    await sliceAndWait(app);
    const fixed = await gcodeGaps(app);
    expect(fixed.count).toBeGreaterThan(100);
    // a fixed layer height gives (nearly) equal gaps
    const spread = Math.max(...fixed.gaps) - Math.min(...fixed.gaps);
    expect(spread, `gaps ${fixed.gaps.slice(0, 3).join(', ')}…`).toBeLessThan(0.01);

    // the panel's finest quality, then Adaptive through the button. Slicing switches the app to the
    // preview, so the plater and the selection come back first.
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setView('plater');
      s.select([s.objects[0].id]);
      s.setProfileSettings({ quality: 0 });
      // `openTool` toggles: only open the panel when the slice did not leave it open
      if (s.activeTool !== 'layerHeight') s.openTool('layerHeight');
    });
    await settle(app, 600);
    await expect(app.locator('.tool-panel')).toBeVisible();
    await app.locator('.tool-panel button:has-text("Adaptive")').click();
    await settle(app, 800);

    const before = await state(app);
    expect(before.objects[0].layerProfile?.length || 0).toBeGreaterThan(100);
    expect((before.objects[0].layerProfile?.length || 0) % 2).toBe(0);
    const bands = await profileBands(app);
    // the sphere is steep at the equator (thick layers allowed) and flat at the poles (thin ones)
    expect(bands.middle, JSON.stringify(bands)).toBeGreaterThan(bands.bottom);
    expect(bands.middle, JSON.stringify(bands)).toBeGreaterThan(bands.top);

    await sliceAndWait(app, before.job?.id);
    const adaptive = await gcodeGaps(app);
    expect(adaptive.count, 'adaptive layers vs fixed 0.2 mm').toBeGreaterThan(fixed.count);
    // and the layer heights vary: the thickest layer is several times the thinnest one
    const min = Math.min(...adaptive.gaps);
    const max = Math.max(...adaptive.gaps);
    expect(max / min, `gaps ${min}–${max}`).toBeGreaterThan(2);
  });

  test('Reset clears the profile and one Ctrl+Z undoes it', async ({ app }) => {
    await importFile(app, SPHERE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
      s.openTool('layerHeight');
    });
    await settle(app, 600);
    await app.locator('.tool-panel button:has-text("Adaptive")').click();
    await settle(app, 800);
    expect((await state(app)).objects[0].layerProfile?.length || 0).toBeGreaterThan(0);

    await press(app, 'Control+z');
    await settle(app, 500);
    expect((await state(app)).objects[0].layerProfile).toBeUndefined();

    // Adaptive again, then Reset through the button: the object prints with its fixed layer height
    await app.locator('.tool-panel button:has-text("Adaptive")').click();
    await settle(app, 800);
    await app.locator('.tool-panel button:has-text("Reset")').click();
    await settle(app, 500);
    const after = await state(app);
    expect(after.objects[0].layerProfile).toBeUndefined();
    await expect(app.locator('.layer-profile-chart .chart-empty')).toBeVisible();
  });
});
