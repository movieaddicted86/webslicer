/**
 * The camera and the bed: the seven standard views by key, the view row (Home, Iso, the two quarter
 * turns), the projection toggle (K), zoom to selection (Z), the outline of a non-rectangular bed and
 * the off-bed marking of an object row.
 *
 * Ported from `.claude/t17-browser.mjs` ("camera", "a non-rectangular bed", "outside-bed marking").
 * The framing is measured by projecting known world points through the camera of the last frame
 * (`frameProbe`), which is exact and independent of lighting; the pixels are only used to prove that a
 * view really draws the model.
 */
import { CUBE, PAIR, importFile, press, read, settle, state } from '../helpers/app';
import { angleDelta, bedOutline, cameraPose, cameraRig, frameProbe, project, shot, tapCamera, toolpathBox } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import type { Page } from '@playwright/test';

const KEYS = ['0', '1', '2', '3', '4', '5', '6'];
/** The bottom view (2) looks through the plate: the bed covers the model, so the canvas does not change. */
const VIEWS_WITH_MODEL = ['0', '1', '3', '4', '5', '6'];

/** The pose at the top view and the pose at the bottom view: key 1, then key 2. */
async function bottomFromTop(app: Page) {
  await press(app, '1');
  await settle(app, 900);
  const top = await cameraPose(app);
  await press(app, '2');
  await settle(app, 900);
  const bottom = await cameraPose(app);
  return { top, bottom };
}

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

  test('a view button frames the same as its view key', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(900);

    await app.getByTestId('view-iso').click();
    await app.waitForTimeout(1000);
    const buttonIso = await frameProbe(app);
    await press(app, '0');
    await app.waitForTimeout(1000);
    const keyIso = await frameProbe(app);
    expect(buttonIso.objects).toEqual(keyIso.objects);
  });

  /**
   * T-105: the row is the phone's four view buttons on every screen – Home, Iso, turn left, turn
   * right – beside the projection toggle and zoom to selection. The named views are gone from it in
   * the Plater and in the Preview; the number keys still reach all seven.
   */
  test('the row has Home, Iso and the two turns on desktop and tablet, and no named view button (AC-1)', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 1200);
    await tapCamera(app);

    const names = async () =>
      app.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="viewer-view-row"] button')).map((b) => b.getAttribute('aria-label')),
      );
    const widths = async () =>
      app.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid="viewer-view-row"] button')).map((b) => b.getBoundingClientRect().width),
      );

    for (const view of ['plater', 'preview'] as const) {
      await app.evaluate((v) => window.webslicer.getState().setView(v), view);
      await settle(app, 1200);
      expect(await names(), `${view}: the row's buttons, in order`).toEqual([
        'Home',
        'Iso view',
        'Turn left 90°',
        'Turn right 90°',
        null, // the projection toggle, labelled by its text (Ortho/Persp)
        'Zoom to selection (Z)',
      ]);
      for (const id of ['view-home', 'view-iso', 'view-turn-left', 'view-turn-right', 'viewer-fit-selection']) {
        await expect(app.getByTestId(id), `${view}: ${id} is in the row`).toBeVisible();
      }
      for (const id of ['top', 'bottom', 'front', 'rear', 'left', 'right']) {
        await expect(app.getByTestId(`viewer-view-${id}`), `${view}: no ${id} button`).toHaveCount(0);
      }
      for (const title of ['Top', 'Front', 'Rear', 'Left', 'Right', 'Bottom']) {
        await expect(app.locator('[data-testid="viewer-view-row"] button', { hasText: title }), `${view}: no ${title} label`).toHaveCount(
          0,
        );
      }
      // the projection toggle is still there (its label is Ortho or Persp)
      await expect(app.getByTestId('viewer-projection')).toBeVisible();
      // desktop sizes: the row's own 28 px buttons, not the phone's 44 px targets
      const sizes = await widths();
      expect(
        sizes.every((w) => w > 0 && w < 44),
        `${view}: desktop button widths ${sizes.join(',')}`,
      ).toBe(true);
      expect(sizes, `${view}: four view buttons beside the projection and zoom`).toHaveLength(6);
    }

    // the tablet: the same row, still the desktop's sizes (820 px is above the 640 px phone query)
    await app.setViewportSize({ width: 820, height: 1180 });
    await settle(app, 1200);
    expect(await names(), 'tablet: the same row').toEqual([
      'Home',
      'Iso view',
      'Turn left 90°',
      'Turn right 90°',
      null,
      'Zoom to selection (Z)',
    ]);
    for (const id of ['top', 'bottom', 'front', 'rear', 'left', 'right']) {
      await expect(app.getByTestId(`viewer-view-${id}`), `tablet: no ${id} button`).toHaveCount(0);
    }
  });

  /**
   * T-105 AC-2: a turn is a quarter turn around the world's vertical axis – the azimuth moves by 90°
   * and nothing else changes – and four turns return. Keys 0–6 still select the seven views.
   */
  test('one turn moves the azimuth by 90° and nothing else; four turns return; keys 1–6 still work (AC-2)', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 1200);

    const turn = async (id: 'view-turn-left' | 'view-turn-right') => {
      await tapCamera(app);
      const before = await cameraRig(app);
      expect(before, 'the camera rig is readable').toBeTruthy();
      await app.getByTestId(id).click();
      await settle(app, 800);
      await tapCamera(app);
      const after = await cameraRig(app);
      expect(after, 'the camera rig is readable after the turn').toBeTruthy();
      return { before: before!, after: after! };
    };

    await app.getByTestId('view-iso').click();
    await settle(app, 900);
    for (const [id, sign] of [
      ['view-turn-right', 1],
      ['view-turn-left', -1],
    ] as const) {
      const { before, after } = await turn(id);
      expect(Math.abs(angleDelta(after.azimuth, before.azimuth) - sign * 90), `${id}: the azimuth moves 90°`).toBeLessThan(0.5);
      expect(Math.abs(after.elevation - before.elevation), `${id}: the elevation is unchanged`).toBeLessThan(0.05);
      expect(Math.abs(after.distance - before.distance), `${id}: the distance is unchanged`).toBeLessThan(0.05);
      expect(Math.hypot(...after.target.map((v, i) => v - before.target[i])), `${id}: the target is unchanged`).toBeLessThan(0.05);
      expect(after.up[2], `${id}: up is +Z, the horizon is level`).toBeGreaterThan(0.999);
    }

    // four turns come back to the pose they started from
    const start = await cameraRig(app);
    for (let i = 0; i < 4; i++) {
      await app.getByTestId('view-turn-right').click();
      await settle(app, 500);
    }
    await tapCamera(app);
    const back = await cameraRig(app);
    expect(Math.hypot(...back!.position.map((v, i) => v - start!.position[i])), 'four turns return').toBeLessThan(0.5);

    // every number key still selects its view, measured on the camera's height above the plate
    const z = async (key: string) => {
      await press(app, key);
      await settle(app, 800);
      await tapCamera(app);
      return (await cameraPose(app))!.z;
    };
    const top = await z('1');
    expect(await z('2'), 'key 2 looks from below').toBeLessThan(top - 10);
    expect(await z('3'), 'key 3 is the front view, near the plate').toBeLessThan(top - 10);
    for (const key of ['0', '4', '5', '6']) {
      expect(await z(key), `key ${key}: a level view above the plate`).toBeGreaterThan(0);
    }
    // and it is the standard view the key names: key 3 faces the bed from -Y, seen looking along +Y
    await press(app, '3');
    await settle(app, 800);
    await tapCamera(app);
    const front = await cameraRig(app);
    expect(Math.abs(angleDelta(front!.azimuth, -90)), 'key 3 is the front view').toBeLessThan(0.5);
  });

  /**
   * The number key 2 still shows the underside in both views (T-105: the button is gone from the
   * row everywhere, the shortcut stays).
   */
  test('key 2 shows the underside in the Plater and in the Preview (#14, T-105)', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await settle(app, 1200);
    await tapCamera(app);

    const plater = await bottomFromTop(app);
    expect(plater.top).not.toBeNull();
    expect(plater.bottom!.z, 'the plater key 2 looks up from below the plate').toBeLessThan(plater.top!.z - 10);

    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1500);
    const preview = await bottomFromTop(app);
    expect(preview.bottom!.z, 'the preview key 2 looks up from below the plate').toBeLessThan(preview.top!.z - 10);
    await expect(app.getByTestId('viewer-view-bottom')).toHaveCount(0);
  });

  /**
   * T-092, the FINDINGS row on the preview's framing: in the Preview a view must frame the *toolpaths*
   * of the visible layers (that is what `focusBox` asks for), not fall back to the whole bed. Measured
   * on the camera target, not on pixels: the visible toolpaths' box centre projects onto the centre of
   * the picture, and the box fills a good part of it.
   */
  test('in the preview every view frames the visible toolpaths, not the empty bed', async ({ app, browser }) => {
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await app.waitForTimeout(1500);
    const box = await toolpathBox(app);
    expect(box, 'the preview has toolpaths').not.toBeNull();
    if (!box) return;
    const middle: [number, number, number] = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2) as [number, number, number];
    const corners: Array<[number, number, number]> = [];
    for (let i = 0; i < 8; i++) {
      corners.push([i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]]);
    }

    for (const [key, view] of [
      ['0', 'iso'],
      ['1', 'top'],
      ['3', 'front'],
    ] as const) {
      await press(app, key);
      await app.waitForTimeout(1000);
      const [centre] = (await project(app, [middle])) ?? [null];
      expect(centre, `view ${view}: the toolpaths are in front of the camera`).not.toBeNull();
      expect(Math.abs(centre![0]), `view ${view}: the toolpaths are centred horizontally`).toBeLessThan(0.2);
      expect(Math.abs(centre![1]), `view ${view}: the toolpaths are centred vertically`).toBeLessThan(0.2);
      const projected = (await project(app, corners)) ?? [];
      const xs = projected.filter((v): v is [number, number] => !!v).map((v) => v[0]);
      const ys = projected.filter((v): v is [number, number] => !!v).map((v) => v[1]);
      // an empty bed would be framed much wider: the print would be a speck in the middle
      expect(
        Math.max(...xs) - Math.min(...xs) > 0.5 || Math.max(...ys) - Math.min(...ys) > 0.5,
        `view ${view}: the toolpaths fill the picture`,
      ).toBe(true);
    }
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
