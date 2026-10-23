/**
 * The viewer spec: everything the t17 suite measured on the canvas (`.claude/t17-browser.mjs`).
 *
 * Same two kinds of evidence as there: the **projection** of known world points through the camera of
 * the last frame (framing, centring, views) and the **pixel classes** of a canvas screenshot (what is
 * drawn: plate, object, toolpaths, gizmo handles). The coverage table in the hand-back report maps
 * every t17 check to the test below.
 */
import { CUBE, PAIR, importFile, press, read } from '../helpers/app';
import { frameProbe, gizmoHandle } from '../helpers/canvas';
import { expect, test } from '../helpers/fixtures';
import { canvasBox, plater } from '../helpers/plater';

test.describe('viewer: import and picking (UAT-04)', () => {
  test('import shows one object with one uploaded instance, centred on the bed', async ({ app }) => {
    await importFile(app, CUBE);
    const p = await plater(app);
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].modelId).toBe(true);

    const frame = await frameProbe(app);
    expect(frame.objects).not.toBeNull();
    const b = frame.objects as [number, number, number, number];
    expect(Math.abs((b[0] + b[2]) / 2)).toBeLessThan(0.25);
    expect(Math.abs((b[1] + b[3]) / 2)).toBeLessThan(0.25);
  });

  test('clicking the object selects it, clicking empty space clears the selection', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([]));
    await app.waitForTimeout(400);
    const box = await canvasBox(app);
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await app.waitForTimeout(600);
    expect(await read(app, (s) => s.selectedIds)).toHaveLength(1);

    await app.mouse.click(box.x + 30, box.y + box.height - 30);
    await app.waitForTimeout(600);
    expect(await read(app, (s) => s.selectedIds)).toHaveLength(0);
  });
});

test.describe('viewer: gizmo and transforms (UAT-05)', () => {
  for (const [key, mode] of [
    ['m', 'translate'],
    ['r', 'rotate'],
    ['s', 'scale'],
  ] as const) {
    test(`the gizmo ${mode === 'translate' ? 'moves' : mode === 'rotate' ? 'rotates' : 'scales'} the instance (${key.toUpperCase()})`, async ({
      app,
    }) => {
      await importFile(app, CUBE);
      await app.evaluate(() => {
        const s = window.webslicer.getState();
        s.select([s.objects[0].id]);
      });
      await app.waitForTimeout(400);
      const box = await canvasBox(app);
      const before = (await plater(app)).objects[0].instances[0];
      await press(app, key);
      await app.waitForTimeout(500);
      expect(await read(app, (s) => s.transformMode)).toBe(mode);

      const handle = await gizmoHandle(app);
      expect(handle, `a gizmo handle is drawn in ${mode} mode`).not.toBeNull();
      const h = handle as { x: number; y: number };
      await app.mouse.move(box.x + h.x, box.y + h.y);
      await app.mouse.down();
      await app.mouse.move(box.x + h.x + 45, box.y + h.y + 25, { steps: 10 });
      await app.mouse.up();
      await app.waitForTimeout(700);

      const after = (await plater(app)).objects[0].instances[0];
      if (mode === 'translate') expect(after.position).not.toEqual(before.position);
      if (mode === 'rotate') expect(after.rotation).not.toEqual(before.rotation);
      if (mode === 'scale') expect(after.scale).not.toEqual(before.scale);
    });
  }

  test('F arms place-on-face and the click applies it', async ({ app }) => {
    await importFile(app, CUBE);
    await press(app, 'r');
    await app.waitForTimeout(300);
    const box = await canvasBox(app);
    await press(app, 'f');
    await app.waitForTimeout(300);
    expect(await read(app, (s) => s.activeTool)).toBe('placeOnFace');
    await app.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await app.waitForTimeout(900);
    expect(await read(app, (s) => s.activeTool)).toBeUndefined();
  });

  test('mirror X flips the instance and a second mirror restores it', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(400);
    const before = (await plater(app)).objects[0].instances[0];
    await app.evaluate(() => window.webslicer.getState().mirror(0));
    await app.waitForTimeout(600);
    const mirrored = (await plater(app)).objects[0].instances[0];
    await app.evaluate(() => window.webslicer.getState().mirror(0));
    await app.waitForTimeout(600);
    const back = (await plater(app)).objects[0].instances[0];

    // the sign goes into exactly one scale component (mirrorPlacement); the magnitudes and the
    // position stay – the instance is turned over in place, not moved
    expect(mirrored.scale.filter((v) => v < 0)).toHaveLength(1);
    expect(mirrored.scale.map(Math.abs)).toEqual(before.scale.map(Math.abs));
    expect(mirrored.position).toEqual(before.position);
    // the rotation only changes when it is not the identity, so it is pinned on its own below
    expect(back.scale).toEqual(before.scale);
    expect(back.rotation).toEqual(before.rotation);
    expect(back.position).toEqual(before.position);
  });

  test('mirror X also flips a rotated instance and a second mirror restores it', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.select([o.id]);
      s.updateInstance(o.id, o.instances[0].id, { rotation: [0.4, 0.2, -Math.PI / 6] });
    });
    await app.waitForTimeout(600);
    const before = (await plater(app)).objects[0].instances[0];
    await app.evaluate(() => window.webslicer.getState().mirror(0));
    await app.waitForTimeout(600);
    const mirrored = (await plater(app)).objects[0].instances[0];
    await app.evaluate(() => window.webslicer.getState().mirror(0));
    await app.waitForTimeout(600);
    const back = (await plater(app)).objects[0].instances[0];

    expect(mirrored.scale[0]).toBeCloseTo(-Math.abs(before.scale[0]), 6);
    expect(back.scale).toEqual(before.scale);
    expect(back.rotation).toEqual(before.rotation);
    // the mirror keeps x/y and drops the turned-over instance to the bed (its rotated mesh reached
    // below z=0), it never sinks the instance: the second mirror cannot lower it again
    expect(back.position[0]).toBe(before.position[0]);
    expect(back.position[1]).toBe(before.position[1]);
    expect(back.position[2]).toBeGreaterThanOrEqual(before.position[2]);
  });
});

test.describe('viewer: keyboard shortcuts', () => {
  test('M/R/S switch the transform mode', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(500);
    const seen: Record<string, string> = {};
    for (const [key, want] of [
      ['r', 'rotate'],
      ['s', 'scale'],
      ['m', 'translate'],
      ['R', 'rotate'],
      ['M', 'translate'],
    ] as const) {
      await press(app, key);
      await app.waitForTimeout(250);
      seen[key] = await read(app, (s) => s.transformMode);
      expect(seen[key], `key ${key}`).toBe(want);
    }
  });

  test('+ adds and − removes instances, Ctrl+A selects every object', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(600);
    const counts: number[] = [];
    for (let i = 0; i < 3; i++) {
      await press(app, '+');
      await app.waitForTimeout(500);
      counts.push(await read(app, (s) => s.objects[0].instances.length));
    }
    await press(app, '=');
    await app.waitForTimeout(500);
    const equals = await read(app, (s) => s.objects[0].instances.length);
    for (let i = 0; i < 2; i++) {
      await press(app, '-');
      await app.waitForTimeout(500);
    }
    const minus = await read(app, (s) => s.objects[0].instances.length);
    expect(counts).toEqual([2, 3, 4]);
    expect(equals).toBe(5);
    expect(minus).toBe(3);

    await press(app, 'Control+a');
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.selectedIds)).toHaveLength(1);
  });

  test('A arranges the instances on the bed', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
      s.setInstanceCount(s.objects[0].id, 3);
    });
    await app.waitForTimeout(900);
    await press(app, 'a');
    await app.waitForTimeout(1200);
    const positions = (await plater(app)).objects[0].instances.map((i) => i.position);
    expect(positions).toHaveLength(3);
    // arranged instances do not sit on top of each other
    const keys = new Set(positions.map((p) => `${p[0]},${p[1]}`));
    expect(keys.size).toBe(3);
  });

  test('Shift+A arranges only the picked instance and leaves the others (T-043)', async ({ app }) => {
    // three separate cubes (an import clears the plater by default), so the picked one has a
    // fixed neighbour on either side after the first arrange
    for (let i = 0; i < 3; i++) await importFile(app, CUBE, { clear: i === 0 });
    await app.waitForTimeout(900);
    await press(app, 'a');
    await app.waitForTimeout(1200);
    const before = await read(app, (s) => s.objects.map((o) => o.instances[0].position));
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.selectInstance(s.objects[0].id, s.objects[0].instances[0].id);
    });
    await press(app, 'Shift+a');
    await app.waitForTimeout(1200);
    const after = await read(app, (s) => s.objects.map((o) => o.instances[0].position));
    expect(after[1]).toEqual(before[1]);
    expect(after[2]).toEqual(before[2]);
    expect(after[0]).not.toEqual(before[0]);
    // the arranged instance stays on the bed and clear of the two fixed ones
    for (const [i, k] of [
      [0, 1],
      [1, 2],
    ]) {
      const dx = Math.abs(after[i][0] - after[k][0]);
      const dy = Math.abs(after[i][1] - after[k][1]);
      // 20 mm cubes: no pair may overlap
      expect(dx >= 20 - 1e-6 || dy >= 20 - 1e-6).toBe(true);
    }
    expect(after[0][0] > 0 && after[0][0] < 250 && after[0][1] > 0 && after[0][1] < 210).toBe(true);
  });

  test('L/P toggle painting and Esc leaves it', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(400);
    await press(app, 'l');
    await app.waitForTimeout(2000);
    expect(await read(app, (s) => s.activeTool)).toBe('paintSupports');
    await press(app, 'l');
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
    await press(app, 'p');
    await app.waitForTimeout(2000);
    expect(await read(app, (s) => s.activeTool)).toBe('paintSeam');
    await press(app, 'Escape');
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.activeTool ?? null)).toBeNull();
  });

  test('F turns place-on-face on and Esc off', async ({ app }) => {
    await importFile(app, CUBE);
    await press(app, 'f');
    await app.waitForTimeout(300);
    expect(await read(app, (s) => s.activeTool)).toBe('placeOnFace');
    await press(app, 'Escape');
    await app.waitForTimeout(300);
    expect(await read(app, (s) => s.activeTool)).toBeUndefined();
  });

  test('Ctrl+Z undoes and Ctrl+Shift+Z / Ctrl+Y redo', async ({ app }) => {
    await importFile(app, PAIR);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await press(app, 'r');
    await app.waitForTimeout(400);
    // an undoable plater change: a second copy. `addInstances` records the add and the arrange it
    // runs afterwards as ONE history step (T-052), so one Ctrl+Z gets back to one copy.
    await press(app, '+');
    await app.waitForTimeout(700);
    const start = await plater(app);
    expect(start.objects[0].instances).toHaveLength(2);

    await press(app, 'Control+z');
    await app.waitForTimeout(700);
    const undone = await plater(app);
    expect(undone.objects[0].instances).toHaveLength(1);
    expect(undone.undo).toBe(start.undo - 1);
    expect(undone.redo).toBe(start.redo + 1);

    await press(app, 'Control+Shift+z');
    await app.waitForTimeout(700);
    const redone = await plater(app);
    expect(redone.objects[0].instances).toHaveLength(2);
    expect(redone.undo).toBe(start.undo);
    expect(redone.redo).toBe(start.redo);

    await press(app, 'Control+z');
    await app.waitForTimeout(700);
    expect((await plater(app)).undo).toBe(start.undo - 1);
    await press(app, 'Control+y');
    await app.waitForTimeout(700);
    const redoneY = await plater(app);
    expect(redoneY.objects[0].instances).toHaveLength(2);
    expect(redoneY.undo).toBe(start.undo);
    expect(redoneY.redo).toBe(start.redo);
  });

  test('Del removes the object, the selected volume and then the picked instance', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await app.waitForTimeout(400);
    await press(app, 'Delete');
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.objects.length)).toBe(0);

    // and again with a volume and two copies: the volume goes first, then the picked copy
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.select([o.id]);
      s.setInstanceCount(o.id, 2);
    });
    await app.waitForTimeout(900);
    // the volume comes from the app's own menu (the production build has no `/src` modules to import)
    await app.locator('.object-row .icon.add').first().click();
    await app.locator('.add-volume-row:has-text("Modifier") button:text-is("box")').first().click();
    await app.waitForTimeout(2000);
    const withVolume = await read(app, (s) => ({
      volumes: s.objects[0].volumes.length,
      instances: s.objects[0].instances.length,
    }));
    expect(withVolume).toEqual({ volumes: 1, instances: 2 });

    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.selectVolume(o.id, o.volumes[0].id);
    });
    await app.waitForTimeout(400);
    await press(app, 'Delete');
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.objects[0].volumes.length)).toBe(0);

    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.selectInstance(o.id, o.instances[1].id);
    });
    await app.waitForTimeout(400);
    await press(app, 'Backspace');
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.objects.length)).toBe(1);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(1);
  });
});
