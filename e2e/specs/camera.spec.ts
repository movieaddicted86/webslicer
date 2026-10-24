/**
 * The camera and the bed: the seven standard views, the projection toggle (K), zoom to selection (Z),
 * the toolbar, the outline of a non-rectangular bed and the off-bed marking of an object row.
 *
 * Ported from `.claude/t17-browser.mjs` ("camera", "a non-rectangular bed", "outside-bed marking").
 * The framing is measured by projecting known world points through the camera of the last frame
 * (`frameProbe`), which is exact and independent of lighting; the pixels are only used to prove that a
 * view really draws the model.
 */
import { CUBE, PAIR, importFile, press, read, state } from '../helpers/app';
import { bedOutline, frameProbe, shot, tapCamera } from '../helpers/canvas';
import { expect, test } from '../helpers/fixtures';

const KEYS = ['0', '1', '2', '3', '4', '5', '6'];
/** The bottom view (2) looks through the plate: the bed covers the model, so the canvas does not change. */
const VIEWS_WITH_MODEL = ['0', '1', '3', '4', '5', '6'];

test.describe('camera: the seven views', () => {
  test('every view key draws and centres the object, only the bottom one hides it', async ({ app }) => {
    // the reference: the same view of an empty bed
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await app.waitForTimeout(1500);
    const emptyWarm: Record<string, number> = {};
    for (const key of KEYS) {
      await press(app, key);
      await app.waitForTimeout(900);
      emptyWarm[key] = (await shot(app)).warmCount;
    }

    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(1200);

    for (const key of KEYS) {
      await press(app, key);
      await app.waitForTimeout(1000);
      const frame = await frameProbe(app);
      const objects = frame.objects as [number, number, number, number] | null;
      expect(objects, `view ${key}: the object is projected`).not.toBeNull();
      if (!objects) continue;
      expect(
        objects.every((v) => Math.abs(v) < 1),
        `view ${key}: the object is inside the picture`,
      ).toBe(true);
      expect(Math.abs((objects[0] + objects[2]) / 2), `view ${key}: horizontal centre`).toBeLessThan(0.25);
      expect(Math.abs((objects[1] + objects[3]) / 2), `view ${key}: vertical centre`).toBeLessThan(0.25);

      const gain = (await shot(app)).warmCount - emptyWarm[key];
      if (VIEWS_WITH_MODEL.includes(key)) expect(gain, `view ${key}: the model is drawn`).toBeGreaterThan(100);
      // from below the plate covers the model; only a few stray pixels of its edge stay visible
      else expect(gain, 'view 2: the plate covers the model').toBeLessThan(50);
    }
  });

  test('K switches the projection and back, without moving the framing, and the choice survives a reload', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(1200);

    const projection = () =>
      app.evaluate(
        () =>
          Array.from(document.querySelectorAll('.viewer-toolbar button'))
            .map((b) => b.textContent)
            .find((t) => t === 'Ortho' || t === 'Persp') ?? null,
      );

    await press(app, 'k');
    await app.waitForTimeout(900);
    const ortho = {
      button: await projection(),
      frame: await frameProbe(app),
      stored: await app.evaluate(() => localStorage.getItem('webslicer.camera.ortho')),
    };
    await press(app, 'k');
    await app.waitForTimeout(900);
    const persp = {
      button: await projection(),
      frame: await frameProbe(app),
      stored: await app.evaluate(() => localStorage.getItem('webslicer.camera.ortho')),
    };

    expect(ortho.button).toBe('Ortho');
    expect(persp.button).toBe('Persp');
    expect(ortho.stored).toBe('ortho');
    expect(persp.stored).toBe('persp');
    // the projection changes how much is on the screen, not where the model sits in it: the projected
    // box keeps its centre and its size to within a few percent
    const orthoObjects = ortho.frame.objects as [number, number, number, number];
    const perspObjects = persp.frame.objects as [number, number, number, number];
    expect(orthoObjects).not.toBeNull();
    for (let i = 0; i < 4; i++) expect(Math.abs(orthoObjects[i] - perspObjects[i]), `box corner ${i}`).toBeLessThan(0.01);

    // the choice is persisted: one more toggle leaves it orthographic across a reload
    await press(app, 'k');
    await app.waitForTimeout(600);
    await app.reload({ waitUntil: 'networkidle' });
    await app.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
    await app.waitForTimeout(2500);
    // the init script survives the reload; the renderer patch does not, so the camera is tapped again
    await tapCamera(app);
    expect(await projection()).toBe('Ortho');
    await press(app, 'k');
    await app.waitForTimeout(600);
    expect(await projection()).toBe('Persp');
  });

  test('Z frames the selection more closely than the whole bed', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(900);
    await press(app, 'z');
    await app.waitForTimeout(1000);
    const zoomBed = await frameProbe(app);

    await app.evaluate(() => {
      const s = window.webslicer.getState();
      if (s.objects.length) s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(500);
    await press(app, 'z');
    await app.waitForTimeout(1000);
    const zoomSel = await frameProbe(app);

    // zooming in pushes the bed corners out of the picture, so the bed's projected box grows while the
    // object stays on the camera axis
    const span = (f: typeof zoomBed) => (f.bed ? Math.max(Math.abs(f.bed[2] - f.bed[0]), Math.abs(f.bed[3] - f.bed[1])) : 0);
    expect(await read(app, (s) => s.selectedIds)).toHaveLength(1);
    expect(span(zoomSel)).toBeGreaterThan(span(zoomBed) * 1.2);
    const objects = zoomSel.objects as [number, number, number, number] | null;
    expect(objects).not.toBeNull();
    expect(Math.abs(((objects as number[])[0] + (objects as number[])[2]) / 2)).toBeLessThan(0.05);
  });

  test('a toolbar button frames the same as its key, and the toolbar lists the seven views', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(900);

    const labels = await app.evaluate(() => Array.from(document.querySelectorAll('.viewer-toolbar button')).map((b) => b.textContent));
    expect(labels).toHaveLength(9);
    expect(labels.slice(0, 7).every((l) => !!l)).toBe(true);

    await app.locator('.viewer-toolbar button', { hasText: 'Top' }).first().click();
    await app.waitForTimeout(1000);
    const buttonTop = await frameProbe(app);
    await press(app, '1');
    await app.waitForTimeout(1000);
    const keyTop = await frameProbe(app);
    expect(buttonTop.objects).toEqual(keyTop.objects);
  });
});

test.describe('camera: the bed', () => {
  test('a non-rectangular bed is outlined and triangulated from its own polygon', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await app.waitForTimeout(1500);
    await press(app, '1');
    await app.waitForTimeout(1400);
    const rect = {
      shape: await read(app, (s) => s.presets.printer.current.bed_shape),
      ...(await bedOutline(app)),
      grid: (await shot(app)).grid,
    };
    expect(rect.shape).toBe('0x0,250x0,250x210,0x210');
    expect(rect.outline).toHaveLength(4);
    expect(rect.plateVerts).toBe(4);

    // the shape goes into the store only – the suite must not write presets to the server
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const bed_shape = '0x0,200x0,200x200,100x200,0x120';
      window.webslicer.setState({
        presets: { ...s.presets, printer: { ...s.presets.printer, current: { ...s.presets.printer.current, bed_shape } } },
      });
    });
    await app.waitForTimeout(2600);
    await press(app, '1');
    await app.waitForTimeout(1600);
    const l = {
      shape: await read(app, (s) => s.presets.printer.current.bed_shape),
      ...(await bedOutline(app)),
      grid: (await shot(app)).grid,
    };
    expect(l.shape.startsWith('0x0,200x0')).toBe(true);
    expect(l.outline).toHaveLength(5);
    expect(l.outline?.[3]).toEqual([100, 200]);
    expect(l.outline?.[4]).toEqual([0, 120]);
    expect(l.plateVerts).toBe(5);

    // both beds are still drawn: the plate colour is on the canvas in both
    const plateCells = (grid: number[][]) => grid.flat().filter((v) => v > 40).length;
    expect(plateCells(rect.grid)).toBeGreaterThan(0);
    expect(plateCells(l.grid)).toBeGreaterThan(0);
  });

  test('the object row marks an off-bed and a too-tall instance', async ({ app }) => {
    await importFile(app, CUBE);
    const row = app.locator('[data-testid="object-row"]').first();
    await expect(row).not.toHaveClass(/outside/);

    // the instance goes off the bed (its x centre leaves the 250 mm plate) …
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[0].id, { position: [300, 125, 0] });
    });
    await app.waitForTimeout(700);
    await expect(row).toHaveClass(/outside/);

    // … and back on the bed but above the 210 mm print height
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[0].id, { position: [125, 105, 220] });
    });
    await app.waitForTimeout(700);
    await expect(row).toHaveClass(/outside/);

    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[0].id, { position: [125, 105, 0] });
    });
    await app.waitForTimeout(700);
    await expect(row).not.toHaveClass(/outside/);
    expect((await state(app)).objects).toHaveLength(1);
  });
});
