/**
 * The preview: slicing, the stats and the export, the two sliders, the layer codes, the view options,
 * the legends and the WebGL resource census – ported from `.claude/t17-browser.mjs` (S10) and
 * `.claude/t18-browser.mjs`.
 *
 * The sliders and toggles never rebuild geometry: they move `geometry.drawRange` (and collapse hidden
 * segments), so the drawn counts of the G-code group are the observable – not pixels.
 */
import fs from 'node:fs';
import { CUBE, importFile, read, settle, sliceAndWait, waitSliceDone } from '../helpers/app';
import { census, gcodeScene, markerKindProbe, visibleMeshes } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { click, fill, outline } from '../helpers/dom';

/*
 * T-057: the 12 tests below only *read* the sliced result – they move sliders, toggle markers, ask
 * for the stats or download the file, and none of them changes the plate. They therefore share one
 * slice (same cube, same fixture preset), made once in `beforeAll`; every test loads that job into its
 * own page instead of slicing again. The three WebGL resource tests at the end slice for themselves:
 * they measure what a slice allocates and frees.
 */
let sharedJob = '';

/*
 * T-057: the tests read the shared job and each gets its own page, so they need no order and can fill
 * both workers. `fullyParallel` stays off for the suite as a whole – the specs that edit the plater
 * rely on one file running its tests one at a time. Here nothing is shared but the job id: Playwright
 * splits a parallel file with hooks into two groups for two workers, and `beforeAll` runs once per
 * group, so the file slices twice instead of 15 times.
 */
test.describe.configure({ mode: 'parallel' });

test.beforeAll(async ({ browser }) => {
  sharedJob = await sliceOnce(browser);
});

/** The state every shared-slice test starts from: the cube in the plater, the preview open. */
async function openPreview(app: Parameters<typeof sliceAndWait>[0]): Promise<string> {
  await openSharedSlice(app, sharedJob);
  expect(sharedJob).not.toBe('');
  return sharedJob;
}

test.describe('preview: the sliced result (UAT-14)', () => {
  // T-057: the send button is disabled only while the server has no host – a host another worker's
  // send test created would enable it, so this test shares the `server-state` lock
  test('the slice finishes, the panel replaces the object list and the stats list the file', { lock: 'server-state' }, async ({ app }) => {
    const jobId = await openPreview(app);
    const slice = await read(app, (s) => ({
      status: s.job?.status,
      outputName: s.job?.outputName,
      layers: s.gcode?.layerCount ?? 0,
      segments: s.gcode?.segmentCount ?? 0,
      range: s.previewLayerRange,
      top: s.gcode?.layerZ[(s.gcode?.layerCount ?? 1) - 1],
    }));
    expect(slice.status).toBe('done');
    expect(slice.layers).toBeGreaterThan(0);
    expect(slice.segments).toBeGreaterThan(0);
    // the whole range is shown when the preview opens
    expect(slice.range).toEqual([0, slice.layers - 1]);

    expect(await app.locator('[data-testid="preview-panel"]').count()).toBe(1);
    expect(await app.locator('.object-list').count()).toBe(0);
    expect(await app.locator('[data-testid="quick-settings"]').count()).toBe(0);

    const stats = await app.evaluate(() => ({
      head: document.querySelector('[data-testid="sliced-info"] .section-head')?.textContent,
      rows: Array.from(document.querySelectorAll('[data-testid="sliced-info"] table tr')).map((tr) =>
        Array.from(tr.children).map((td) => td.getAttribute('title') || td.textContent),
      ),
      href: document.querySelector('[data-testid="sliced-info"] a.button.primary')?.getAttribute('href'),
      actions: Array.from(
        document.querySelectorAll('[data-testid="sliced-info"] .actions a, [data-testid="sliced-info"] .actions button'),
      ).map((b) => b.textContent),
      sendDisabled: (
        document.querySelector('[data-testid="sliced-info"] .actions button.secondary:last-of-type') as HTMLButtonElement | null
      )?.disabled,
    }));
    expect(stats.head).toContain('Sliced info');
    const labels = stats.rows.map((r) => r[0]);
    expect(labels).toEqual(expect.arrayContaining(['File', 'Estimated time', 'Filament', 'Layers', 'Size']));
    expect(stats.rows.find((r) => r[0] === 'File')?.[1]).toBe(slice.outputName);
    expect(stats.rows.find((r) => r[0] === 'Layers')?.[1]).toBe(String(slice.layers));
    expect(stats.href).toBe(`/api/jobs/${jobId}/gcode?download`);
    expect(stats.actions).toEqual(['⤓ Export G-code', '🗂 Save to library', '➤ Send to printer']);
    // the fixture data configures no host, so there is nothing to send to
    expect(stats.sendDisabled).toBe(true);
  });

  test('Export G-code downloads the file with its thumbnail blocks', async ({ app }) => {
    await openPreview(app);
    const [download] = await Promise.all([
      app.waitForEvent('download', { timeout: 90_000 }),
      app.locator('[data-testid="sliced-info"] a.button.primary').click(),
    ]);
    const file = await download.path();
    expect(file).toBeTruthy();
    const data = fs.readFileSync(file as string);
    const head = data.subarray(0, 6000).toString('latin1');
    expect(download.suggestedFilename()).toBe(await read(app, (s) => s.job?.outputName));
    expect(data.length).toBeGreaterThan(1000);
    // the browser renderer asked for the printer's 160×120 PNG preview (the printer profile carries
    // it), so the file starts with the thumbnail block the display reads
    expect(head).toContain('; thumbnail begin 160x120');
    expect(head).toContain('; thumbnail end');
  });
});

test.describe('preview: the sliders (UAT-06, UAT-19)', () => {
  test('the layers section has both layer sliders, the marker track and the three code buttons', async ({ app }) => {
    await openPreview(app);
    const layers = await read(app, (s) => s.gcode?.layerCount ?? 0);
    const panel = await app.evaluate(() => ({
      head: document.querySelector('.layers .section-head')?.textContent,
      labels: Array.from(document.querySelectorAll('.layers > label.small:not(.checkbox):not(.view-mode)')).map((l) =>
        l.firstChild?.textContent?.trim(),
      ),
      sliders: Array.from(document.querySelectorAll('.layers input[type=range]')).map((i) => ({
        min: (i as HTMLInputElement).min,
        max: (i as HTMLInputElement).max,
      })),
      addButtons: Array.from(document.querySelectorAll('.layer-codes-add button')).map((b) => ({
        text: b.textContent,
        title: b.getAttribute('title'),
      })),
      atZ: document.querySelector('.layer-codes-add .muted')?.textContent,
      note: document.querySelector('.layers .muted.small')?.textContent,
    }));
    expect(panel.head).toContain(`/ ${layers}`);
    expect(panel.labels).toEqual(['Top', 'Bottom']);
    // the top slider, the bottom slider and the move slider of the top layer
    expect(panel.sliders).toHaveLength(3);
    expect(panel.sliders[0]).toEqual({ min: '0', max: String(layers - 1) });
    expect(panel.sliders[1]).toEqual({ min: '0', max: String(layers - 1) });
    expect(panel.addButtons.map((b) => b.text)).toEqual(['＋ Color', '⏸ Pause', '✎ Custom']);
    expect(panel.atZ).toMatch(/^At Z /);
  });

  test('the top layer slider draws fewer toolpaths on a shorter range', async ({ app }) => {
    await openPreview(app);
    const layers = await read(app, (s) => s.gcode?.layerCount ?? 0);
    const steps: Array<{ frac: number; segs: number; range: number[] }> = [];
    for (const frac of [1, 0.6, 0.3, 0.05]) {
      const top = Math.max(0, layers - 1);
      await app.evaluate(
        ([f, t]) => window.webslicer.getState().setPreviewLayerRange([0, Math.max(0, Math.floor((t as number) * (f as number)))]),
        [frac, top] as const,
      );
      await app.waitForTimeout(1000);
      steps.push({ frac, segs: (await gcodeScene(app)).segs, range: await read(app, (s) => s.previewLayerRange) });
    }
    expect(steps.map((s) => s.segs)).toEqual([...steps.map((s) => s.segs)].sort((a, b) => b - a));
    for (let i = 1; i < steps.length; i++) expect(steps[i].segs, `step ${steps[i].frac}`).toBeLessThan(steps[i - 1].segs);
    expect(steps[0].range[0]).toBe(0);
  });

  test('the top layer slider of the panel sets the range, the field follows', async ({ app }) => {
    await openPreview(app);
    const top = app.locator('[data-testid="layer-slider"]');
    await fill(app, '[data-testid="layer-slider"]', '10', 800);
    expect(await read(app, (s) => s.previewLayerRange)).toEqual([0, 10]);
    expect(await top.inputValue()).toBe('10');
    expect(await app.locator('.layers .section-head').textContent()).toContain('Layers 1 – 11');
  });

  test('the Move slider cuts the top layer and puts it back', async ({ app }) => {
    await openPreview(app);
    // the markers make the cut observable: the drawn markers are exactly the ones up to the cut
    await app.evaluate(() => window.webslicer.getState().togglePreviewMarker('retract'));
    await app.waitForTimeout(1200);
    const first = await markerKindProbe(app);
    expect(first, 'the retract markers are drawn').not.toBeNull();
    const probe = first as NonNullable<typeof first>;
    expect(probe.drawn).toBe(probe.total);

    const cuts = [Math.floor(probe.move[Math.floor(probe.total * 0.5)]), Math.floor(probe.move[Math.floor(probe.total * 0.1)])];
    const steps: Array<{ drawn: number; expected: number }> = [];
    for (const cut of cuts) {
      await app.evaluate((v) => window.webslicer.getState().setPreviewMoveCut(v), cut);
      await app.waitForTimeout(1100);
      const p = await markerKindProbe(app);
      steps.push({ drawn: (p as NonNullable<typeof p>).drawn, expected: probe.move.filter((m) => m <= cut).length });
    }
    for (const step of steps) expect(step.drawn, 'the markers up to the cut').toBe(step.expected);
    expect(steps[0].drawn).toBeGreaterThan(steps[1].drawn);

    const note = await app.locator('[data-testid="move-slider-panel"] .muted.small').textContent();
    await app.evaluate(() => window.webslicer.getState().setPreviewMoveCut(undefined));
    await app.waitForTimeout(1000);
    expect((await markerKindProbe(app))?.drawn).toBe(probe.total);
    expect(await app.locator('[data-testid="move-slider-panel"] .muted.small').textContent()).not.toBe(note);
    expect(note).toMatch(/\/ \d+ moves/);
  });

  test('the code buttons add a colour change and a pause with their slider markers', async ({ app }) => {
    const jobId = await openPreview(app);
    await fill(app, '[data-testid="layer-slider"]', '10', 800);
    await click(app, '.layer-codes-add button:has-text("Color")', 700);
    await waitSliceDone(app, jobId);
    const afterColor = await read(app, (s) => s.job?.id);
    expect(afterColor).not.toBe(jobId);

    await fill(app, '[data-testid="layer-slider"]', '20', 800);
    await click(app, '.layer-codes-add button:has-text("Pause")', 700);
    await waitSliceDone(app, afterColor);

    const codes = await app.evaluate(() => ({
      codes: window.webslicer
        .getState()
        .customGcodes.map((c) => ({ type: c.type, z: Number(c.printZ.toFixed(2)), color: c.color ?? null, extra: c.extra ?? null })),
      rows: Array.from(document.querySelectorAll('.code-list li')).map((li) => li.textContent),
      markers: Array.from(document.querySelectorAll('.slider-markers .marker')).map((m) => m.getAttribute('title')),
    }));
    expect(codes.codes.map((c) => c.type)).toEqual(['color_change', 'pause']);
    expect(codes.codes[1].extra).toBe('Insert item');
    expect(codes.rows).toHaveLength(2);
    expect(codes.markers).toHaveLength(2);
    expect(codes.markers[1]).toContain('Pause');

    // the pause message is edited in place (no re-slice needed) and the entry removed again
    await fill(app, '.code-list li:has(.code-type:text-is("Pause")) input.code-text', 'T-030 pause', 600);
    expect(await read(app, (s) => s.customGcodes.find((c) => c.type === 'pause')?.extra)).toBe('T-030 pause');
    const beforeRemove = await read(app, (s) => s.job?.id);
    await click(app, '.code-list li:has(.code-type:text-is("Pause")) button.icon', 800);
    await waitSliceDone(app, beforeRemove);
    // the panel renders its list with the frame after the re-slice, so wait for the row instead of
    // reading the DOM once right after `waitSliceDone` returned (the assertions below are unchanged)
    await app.waitForFunction(() => document.querySelectorAll('.code-list li').length === 1, null, { timeout: 60_000 });
    const after = await app.evaluate(() => ({
      codes: window.webslicer.getState().customGcodes.map((c) => c.type),
      rows: document.querySelectorAll('.code-list li').length,
    }));
    expect(after).toEqual({ codes: ['color_change'], rows: 1 });
  });
});

test.describe('preview: what is drawn (UAT-19)', () => {
  test('the view options list the six markers and Shells, and the toggles reach the store', async ({ app }) => {
    await openPreview(app);
    const options = await app.evaluate(() => ({
      labels: Array.from(document.querySelectorAll('.view-options label')).map((l) => ({
        text: l.textContent?.trim(),
        title: l.getAttribute('title'),
        swatch: l.querySelector('.swatch')?.getAttribute('style') ?? null,
        checked: (l.querySelector('input') as HTMLInputElement).checked,
      })),
      modes: Array.from(document.querySelectorAll('.view-mode select option')).map((o) => (o as HTMLOptionElement).value),
    }));
    expect(options.labels).toHaveLength(7);
    expect(options.labels.slice(0, 6).map((l) => l.text)).toEqual([
      'Retractions',
      'Deretractions',
      'Seams',
      'Wipe',
      'Tool changes',
      'Color changes',
    ]);
    expect(options.labels[6].text).toBe('Shells');
    expect(options.labels.every((l) => l.swatch !== null || l.text === 'Shells')).toBe(true);
    expect(options.modes).toEqual([
      'feature',
      'height',
      'width',
      'speed',
      'fan',
      'temperature',
      'flow',
      'layertime',
      'layertimelog',
      'tool',
      'colorprint',
    ]);

    const before = await read(app, (s) => s.previewMarkers);
    await app.locator('.view-options label').first().click();
    await app.waitForTimeout(600);
    const after = await read(app, (s) => s.previewMarkers);
    expect(after.retract).toBe(!before.retract);
    await app.locator('.view-options label').first().click();
    await app.waitForTimeout(400);

    await app.locator('.view-options label:has-text("Shells") input').click();
    await app.locator('.layers label.checkbox:has-text("Show travel moves") input').click();
    await app.waitForTimeout(600);
    const toggles = await read(app, (s) => ({ shells: s.previewShowShells, travel: s.previewShowTravel }));
    expect(toggles).toEqual({ shells: true, travel: true });
    expect(await app.locator('.view-options label:last-of-type input').isChecked()).toBe(true);
  });

  test('toggling a marker kind draws its markers, and Show travel draws the travel moves', async ({ app }) => {
    await openPreview(app);
    const base = await gcodeScene(app);
    const kinds = ['retract', 'deretract', 'seam', 'wipe', 'tool_change', 'color_change'];
    const drawn: Record<string, number> = {};
    for (const kind of kinds) {
      await app.evaluate((k) => window.webslicer.getState().togglePreviewMarker(k), kind);
      await app.waitForTimeout(800);
      drawn[kind] = (await gcodeScene(app)).points;
      await app.evaluate((k) => window.webslicer.getState().togglePreviewMarker(k), kind);
      await app.waitForTimeout(400);
    }
    // the kinds this G-code has markers for are exactly the ones that add points; a retraction at
    // least is certain
    expect(drawn.retract).toBeGreaterThan(base.points);
    expect(Object.values(drawn).filter((p) => p > base.points).length).toBeGreaterThan(0);

    await app.evaluate(() => window.webslicer.getState().setPreviewShowTravel(true));
    await app.waitForTimeout(900);
    const travelOn = await gcodeScene(app);
    await app.evaluate(() => window.webslicer.getState().setPreviewShowTravel(false));
    await app.waitForTimeout(700);
    const travelOff = await gcodeScene(app);
    expect(travelOn.travel).toBeGreaterThan(0);
    expect(travelOn.segs).toBe(travelOff.segs);
  });

  test('hiding a feature collapses its toolpaths, and the legend toggles it', async ({ app }) => {
    await openPreview(app);
    const base = await gcodeScene(app);
    const features = await read(app, (s) => s.previewFeatureVisibility);
    const counts = await read(app, (s) => {
      const g = s.gcode;
      if (!g) return {} as Record<string, number>;
      const out: Record<string, number> = {};
      for (const t of g.featureTypes) out[t] = 0;
      for (let i = 0; i < g.segmentCount; i++) out[g.featureTypes[g.types[i]]]++;
      return out;
    });

    const withSegments = Object.keys(features).filter((f) => (counts[f] ?? 0) > 0);
    expect(withSegments.length).toBeGreaterThanOrEqual(5);
    for (const feature of withSegments) {
      await app.evaluate((f) => window.webslicer.getState().togglePreviewFeature(f), feature);
      await app.waitForTimeout(700);
      const hidden = await gcodeScene(app);
      expect(hidden.collapsed, `${feature} is collapsed`).toBeGreaterThan(base.collapsed);
      expect(hidden.segs, `${feature} keeps the drawn range`).toBe(base.segs);
      await app.evaluate((f) => window.webslicer.getState().togglePreviewFeature(f), feature);
      await app.waitForTimeout(300);
    }

    // the legend row of the same feature is the second way to hide it
    await app.evaluate(() => window.webslicer.getState().setPreviewColorMode('feature'));
    await app.waitForTimeout(600);
    const first = app.locator('[data-testid="legend"].features li:not(.static)').first();
    const name = (await first.locator('.name').textContent()) ?? '';
    expect(await first.locator('.pct').textContent()).toMatch(/%$/);
    expect(await first.locator('.len').textContent()).toMatch(/m$/);
    await first.click();
    await app.waitForTimeout(700);
    expect((await read(app, (s) => s.previewFeatureVisibility))[name]).toBe(false);
    await expect(app.locator('[data-testid="legend"].features li', { hasText: name }).first()).toHaveClass(/off/);
    await first.click();
    await app.waitForTimeout(500);
  });

  test('every colour mode keeps the toolpaths and shows more than a headline', async ({ app }) => {
    await openPreview(app);
    const ref = (await gcodeScene(app)).segs;
    const modes = await app.evaluate(() =>
      Array.from(document.querySelectorAll('.view-mode select option')).map((o) => (o as HTMLOptionElement).value),
    );
    const seen: Record<string, { mode: string; segs: number; legend: string | null; lines: number }> = {};
    for (const mode of modes) {
      await app.locator('.view-mode select').selectOption(mode);
      await app.waitForTimeout(800);
      const legend = app.locator('[data-testid="legend"]').first();
      const has = await legend.count();
      seen[mode] = {
        mode: await read(app, (s) => s.previewColorMode),
        segs: (await gcodeScene(app)).segs,
        legend: has ? await legend.getAttribute('class') : null,
        lines: has ? (await outline(app, '[data-testid="legend"]')).length : 0,
      };
    }
    // the geometry is repainted, never rebuilt: every mode draws the same toolpaths
    for (const mode of modes) {
      expect(seen[mode].mode, mode).toBe(mode);
      expect(seen[mode].segs, mode).toBe(ref);
    }
    const withLegend = Object.values(seen).filter((s) => s.legend);
    expect(withLegend.length).toBeGreaterThanOrEqual(4);
    expect(withLegend.every((s) => s.lines > 1)).toBe(true);
    await app.locator('.view-mode select').selectOption('feature');
    await app.waitForTimeout(600);
  });

  test('Shells draws the plater meshes over the toolpaths', async ({ app }) => {
    await openPreview(app);
    await app.evaluate(() => window.webslicer.getState().setPreviewShowShells(false));
    await app.waitForTimeout(1000);
    const off = await visibleMeshes(app);
    await app.evaluate(() => window.webslicer.getState().setPreviewShowShells(true));
    await app.waitForTimeout(1200);
    const on = await visibleMeshes(app);
    expect(on.meshes).toBeGreaterThan(off.meshes);
    expect(on.meshes).toBeGreaterThan(0);
    expect(on.toolpaths).toBeGreaterThan(0);
    expect(on.toolpaths).toBe(off.toolpaths);
  });
});

test.describe('preview: the WebGL resources', () => {
  test('importing the same model again costs no new GPU texture and no growing scene', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await app.waitForTimeout(1500);
    // the first import of a page builds meshes the renderer keeps (the viewer's one-time work), so a
    // warm-up cycle runs before the measured ones – the check is about the repeats, not the first
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await app.waitForTimeout(1800);
    const snapshots: Record<string, Awaited<ReturnType<typeof census>>> = { empty: await census(app) };
    for (const round of [1, 2, 3]) {
      await importFile(app, CUBE);
      snapshots[`after${round}`] = await census(app);
      await app.evaluate(() => window.webslicer.getState().clearObjects());
      await app.waitForTimeout(1800);
      snapshots[`delete${round}`] = await census(app);
    }
    expect(await read(app, (s) => s.objects.length)).toBe(0);

    const textures = (k: string) => snapshots[k].rendererMemory?.textures ?? -1;
    expect(textures('after1')).toBe(textures('after2'));
    expect(textures('after2')).toBe(textures('after3'));
    expect(textures('after3')).toBe(textures('empty'));

    // B1: dispose the plater geometry with its object, so a cycle gives everything back (no +1)
    const geometries = (k: string) => snapshots[k].rendererMemory?.geometries ?? -1;
    for (const round of [1, 2, 3]) {
      const previous = round === 1 ? 'empty' : `delete${round - 1}`;
      expect(geometries(`delete${round}`) - geometries(previous), `cycle ${round}`).toBe(0);
    }
    // deleting an object empties the scene graph again, and the shader programs do not grow
    const drawables = (k: string) => snapshots[k].scene.drawables;
    for (const round of [1, 2, 3]) expect(drawables(`delete${round}`), `drawables after ${round}`).toBe(drawables('empty'));
    expect(snapshots.after3.programs).toBe(snapshots.after1.programs);
  });

  test('B1: load, slice and clear returns the GPU geometries to their start value', async ({ app }) => {
    // the first import of a page builds resources the renderer keeps, so this cycle is a warm-up only
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await importFile(app, CUBE);
    await sliceAndWait(app);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1200);
    await app.evaluate(() => {
      window.webslicer.getState().clearObjects();
      window.webslicer.getState().setView('plater');
    });
    await app.waitForTimeout(1800);

    const start = await census(app);
    await importFile(app, CUBE);
    await sliceAndWait(app);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1500);
    const sliced = await census(app);
    // the preview and the plater really did allocate geometry
    expect(sliced.rendererMemory?.geometries ?? 0).toBeGreaterThan(start.rendererMemory?.geometries ?? 0);

    // clearObjects drops the G-code and the objects: both groups have to give their GPU resources back
    await app.evaluate(() => {
      window.webslicer.getState().clearObjects();
      window.webslicer.getState().setView('plater');
    });
    await app.waitForTimeout(1800);
    const cleared = await census(app);
    expect(cleared.rendererMemory?.geometries).toBe(start.rendererMemory?.geometries);
  });

  test('B1: adding and removing ten objects leaves no GPU geometry behind', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().setView('plater'));
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    // one warm-up import: the first model of a page builds resources the renderer keeps
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await app.waitForTimeout(1800);
    const start = await census(app);

    await importFile(app, CUBE);
    for (let i = 1; i < 10; i++) await importFile(app, CUBE, { clear: false });
    const ids = await read(app, (s) => s.objects.map((o) => o.id));
    expect(ids.length).toBe(10);
    const loaded = await census(app);
    expect(loaded.rendererMemory?.geometries ?? 0).toBeGreaterThan(start.rendererMemory?.geometries ?? 0);

    await app.evaluate((list) => window.webslicer.getState().removeObjects(list), ids);
    await app.waitForTimeout(1800);
    const removed = await census(app);
    expect(await read(app, (s) => s.objects.length)).toBe(0);
    expect(removed.rendererMemory?.geometries).toBe(start.rendererMemory?.geometries);
  });
});
