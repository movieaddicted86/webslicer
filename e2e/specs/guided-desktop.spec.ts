/**
 * The guided start on a desktop and a tablet (T-106): the phone's flow in its second shell.
 *
 * The steps, the rules and the buttons are the phone's (`GuidedFlow.tsx`, `guidedFlow.ts`); a wide
 * window only gets another container – a floating card at the bottom centre of the 3D view. This spec
 * walks the flow with the pointer and checks what the card promises: it stays inside the scene and
 * clear of the tool strip and the view row, the plate and the model are framed above it, step 4
 * slices and sends through the same controls the free layout has, and the Preview ends the flow with
 * the result, Send, Back and Finish.
 *
 * The suite's fixture switches the preference off (every other desktop spec starts in the free
 * layout); `armGuidedStart` turns it on for a fresh page.
 */
import { expect, test } from '../helpers/fixtures';
import {
  armGuidedStart,
  blockSessionRestore,
  CUBE,
  importFile,
  openApp,
  read,
  settle,
  waitSliceDone,
} from '../helpers/app';
import { addPrinter, clearUploads, HAS_MOCK_HOST, removePrinters, uploads, type TestPrinter } from '../helpers/mock-host';
import { project, tapCamera } from '../helpers/canvas';
import { E2E_PRINTER } from '../global-setup';
import type { Page } from '@playwright/test';

/** The card, the strip and the view row, in viewport pixels. */
async function boxes(app: Page) {
  return app.evaluate(() => {
    const box = (sel: string) => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } : null;
    };
    return {
      card: box('[data-testid="guided-float-card"]'),
      strip: box('[data-testid="tool-strip"]'),
      row: box('[data-testid="viewer-view-row"]'),
      scene: box('.scene-area'),
      panel: box('[data-testid="context-panel"]'),
      canvas: box('.viewer canvas'),
    };
  });
}

/** The plate's footprint corners and every object's box, in world coordinates (as the phone spec). */
async function sceneCorners(app: Page) {
  return read(app, (s) => {
    const shape = (s.presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200').split(',');
    const bed = shape.map((part) => {
      const [x, y] = part.split('x').map(Number);
      return [x, y, 0] as [number, number, number];
    });
    const models: Array<[number, number, number]> = [];
    for (const o of s.objects) {
      for (const i of o.instances) {
        for (let k = 0; k < 8; k++) {
          models.push([
            i.position[0] + ((k & 1 ? 1 : -1) * (o.size[0] * i.scale[0])) / 2,
            i.position[1] + ((k & 2 ? 1 : -1) * (o.size[1] * i.scale[1])) / 2,
            i.position[2] + (k & 4 ? 1 : 0) * o.size[2] * i.scale[2],
          ]);
        }
      }
    }
    return { bed, models };
  });
}

/**
 * AC-4: the card lies in the scene and clear of the strip and the view row; then, with the camera
 * tapped, plate and model project completely into the room above the card (4 px tolerance).
 */
async function expectCardAndFraming(app: Page, what: string) {
  const b = await boxes(app);
  expect(b.card, `${what}: the card is rendered`).toBeTruthy();
  expect(b.scene, `${what}: the scene is rendered`).toBeTruthy();
  expect(b.strip, `${what}: the tool strip is rendered`).toBeTruthy();
  expect(b.row, `${what}: the view row is rendered`).toBeTruthy();
  if (!b.card || !b.scene || !b.strip || !b.row) return;
  expect(b.card.w, `${what}: the card is no wider than 520 px`).toBeLessThanOrEqual(520);
  expect(b.card.y, `${what}: the card starts inside the scene`).toBeGreaterThanOrEqual(b.scene.y);
  expect(b.card.bottom, `${what}: the card ends inside the scene`).toBeLessThanOrEqual(b.scene.bottom);
  expect(b.card.h, `${what}: the card is at most 40 % of the scene`).toBeLessThanOrEqual(b.scene.h * 0.4 + 1);
  expect(b.card.y, `${what}: the card is below the tool strip`).toBeGreaterThanOrEqual(b.strip.bottom);
  expect(b.card.y, `${what}: the card is below the view row`).toBeGreaterThanOrEqual(b.row.bottom);
  // the side panel keeps its place: the card never covers it
  if (b.panel) expect(b.card.right, `${what}: the card keeps clear of the context panel`).toBeLessThanOrEqual(b.panel.x + 1);

  await settle(app, 1200);
  await tapCamera(app);
  const { bed, models } = await sceneCorners(app);
  const ndc = await project(app, [...bed, ...models]);
  expect(ndc, `${what}: the camera is tapped`).not.toBeNull();
  expect(
    ndc!.filter((p) => !p),
    `${what}: every corner is in front of the camera`,
  ).toHaveLength(0);
  const canvas = b.canvas!;
  const px = (v: number) => canvas.x + ((v + 1) / 2) * canvas.w;
  const py = (v: number) => canvas.y + ((1 - v) / 2) * canvas.h;
  const ys = ndc!.map((p) => py(p![1]));
  const xs = ndc!.map((p) => px(p![0]));
  expect(Math.min(...ys), `${what}: nothing sits under the view row`).toBeGreaterThanOrEqual(b.row.bottom - 4);
  expect(Math.max(...ys), `${what}: plate and model are above the card`).toBeLessThanOrEqual(b.card.y + 4);
  expect(Math.min(...xs), `${what}: the scene is not cut on the left`).toBeGreaterThanOrEqual(canvas.x - 4);
  expect(Math.max(...xs), `${what}: the scene is not cut on the right`).toBeLessThanOrEqual(canvas.x + canvas.w + 4);
}

test.describe('the guided start on a wide window (T-106)', () => {
  test('a fresh desktop opens the card at step 1, inside the scene and above the framed plate (AC-2, AC-4, AC-6)', async ({ app }) => {
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-float-card')).toBeVisible();
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
    await expect(app.getByTestId('guided-header')).toContainText('Pick a model');
    // the card holds the phone's step body; the sheet's shell stays away on this window
    await expect(app.getByTestId('guided-card')).toBeVisible();
    await expect(app.getByTestId('sheet-handle')).toHaveCount(0);
    await expect(app.getByTestId('guided-next')).toBeDisabled();
    await expect(app.getByTestId('guided-back')).toHaveCount(0);
    await expect(app.getByTestId('guided-skip')).toHaveText('Skip guided start');
    await expectCardAndFraming(app, 'guided step 1');

    // the card's buttons are reachable with Tab, and Escape does not close the flow behind the user
    // (Next is disabled until a model is on the plate, so the chain skips it, as a disabled button
    // always does – Skip is the next stop)
    await app.getByTestId('guided-pick').focus();
    await app.keyboard.press('Tab');
    await expect(app.getByTestId('guided-library')).toBeFocused();
    await app.keyboard.press('Tab');
    await expect(app.getByTestId('guided-skip')).toBeFocused();
    await app.keyboard.press('Escape');
    await expect(app.getByTestId('guided-float-card')).toBeVisible();
    expect(await read(app, (s) => s.flowStep), 'Escape left the flow alone').toBe(1);
  });

  test('the four steps carry a model to a slice and a send, and the changed setting reaches the job (AC-2, AC-5)', async ({ app }) => {
    let created: TestPrinter[] = [];
    try {
      if (HAS_MOCK_HOST) {
        created = [await addPrinter(app, { name: 'Guided desktop host', presetName: E2E_PRINTER })];
        await app.evaluate(async () => {
          const s = window.webslicer.getState();
          await s.refreshPresetLists();
          await s.refreshPhysicalPrinters();
        });
        clearUploads();
      }
      await armGuidedStart(app);
      // step 1: the library dialog is the flow's way to a model – already loaded, so import the cube
      await importFile(app, CUBE, { clear: false });
      await expect(app.getByTestId('guided-file')).toContainText('calibration_cube_20mm');
      await expect(app.getByTestId('guided-next')).toBeEnabled();
      await app.getByTestId('guided-next').click();

      // step 2: the same preset rows the panel's card shows
      await expect(app.getByTestId('guided-step')).toHaveText('2 / 4');
      await expect(app.getByTestId('guided-header')).toContainText('Printer and profiles');
      for (const type of ['printer', 'filament', 'print'] as const) {
        const select = app.locator(`[data-testid="preset-select-${type}"] select`).first();
        await expect(select).toBeVisible();
        await expect(select).toHaveValue(new RegExp(type === 'printer' ? E2E_PRINTER.slice(0, 4) : '.'));
      }
      await expect(app.getByTestId('guided-back')).toBeVisible();
      await app.getByTestId('guided-next').click();

      // step 3: one quick setting changed, and the step keeps the card's own height
      await expect(app.getByTestId('guided-step')).toHaveText('3 / 4');
      await expect(app.getByTestId('guided-card')).toContainText('Fine as it is? Just continue.');
      // the panel keeps its own copy of the quick settings; the step's is the card's one
      await app.getByTestId('guided-card').getByTestId('quick-density').selectOption('40%');
      await settle(app, 900);
      expect(await read(app, (s) => s.presets.print.current.fill_density)).toBe('40%');
      await expectCardAndFraming(app, 'guided step 3');
      await app.getByTestId('guided-next').click();

      // step 4: the summary, then the free layout's own destination and Slice button inside the card
      await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');
      await expect(app.getByTestId('guided-summary')).toContainText(E2E_PRINTER);
      await expect(app.getByTestId('guided-next')).toHaveCount(0);
      await expect(app.getByTestId('guided-skip')).toHaveText('More settings');
      // the panel keeps its own copies; the card's are the step's
      const card = app.getByTestId('guided-float-card');
      await expect(card.getByTestId('destination')).toBeVisible();
      await expect(card.getByTestId('slice-button')).toBeVisible();
      await expectCardAndFraming(app, 'guided step 4');

      await card.getByTestId('slice-button').click();
      await waitSliceDone(app, undefined);
      const job = await read(app, (s) => ({ id: s.job?.id ?? '', status: s.job?.status }));
      expect(job.status).toBe('done');
      const gcode = await app.evaluate(async (id) => (await fetch(`/api/jobs/${id}/gcode`)).text(), job.id);
      expect(gcode, 'the quick setting reached the sliced job').toMatch(/fill_density\s*=\s*40%/);

      // AC-5: the Preview carries the flow's end – result, Send, Back and Finish
      await expect(app.getByTestId('guided-float-card')).toBeVisible();
      await expect(app.getByTestId('phone-result')).toBeVisible({ timeout: 30_000 });
      // the free layout's footer holds its own Send; the card's one is the flow's
      const ending = app.getByTestId('guided-float-card');
      await expect(ending.getByTestId('send-button')).toBeVisible();
      await expect(app.getByTestId('guided-preview-back')).toBeVisible();
      await expect(app.getByTestId('guided-preview-finish')).toBeVisible();

      if (HAS_MOCK_HOST) {
        await ending.getByTestId('send-button').click();
        await expect(app.getByTestId('modal')).toBeVisible();
        await app.getByTestId('modal-primary').click();
        await expect(app.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
        const sent = uploads();
        expect(sent, 'the guided flow sent the job').toHaveLength(1);
        expect(sent[0].bytes).toBeGreaterThan(1000);
      }

      // Back returns to the Plater at step 4; Finish closes the card and leaves the free layout
      await app.getByTestId('guided-preview-back').click();
      await expect.poll(() => read(app, (s) => s.view)).toBe('plater');
      await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');
      await app.getByTestId('view-preview').click();
      await expect.poll(() => read(app, (s) => s.view)).toBe('preview');
      await app.getByTestId('guided-preview-finish').click();
      await expect(app.getByTestId('guided-float-card')).toHaveCount(0);
      expect(await read(app, (s) => s.flowStep), 'Finish closed the flow').toBeUndefined();
    } finally {
      if (created.length) await removePrinters(app, created);
      clearUploads();
    }
  });

  test('Skip asks about next time, both answers behave, and the menu and an emptied plate reopen the flow (AC-3)', async ({ app }) => {
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-float-card')).toBeVisible();
    await app.getByTestId('guided-skip').click();
    const question = app.getByTestId('guided-skip-question');
    await expect(question).toContainText('Show the guided start next time?');
    // Yes: back to the free layout, the preference stays on
    await app.getByTestId('guided-skip-yes').click();
    await expect(app.getByTestId('guided-float-card')).toHaveCount(0);
    expect(await read(app, (s) => s.flowStep), 'Yes closed the flow').toBeUndefined();
    expect(await read(app, (s) => s.guidedStart), 'Yes keeps the preference on').toBe(true);
    // the plate is still empty: the answer keeps the flow away until a model was on it (a model
    // ends the dismissal, and the plate emptied after it opens the flow again – below)
    expect(await read(app, (s) => s.flowDismissed), 'Yes leaves the empty plate alone').toBe(true);
    await expect(app.getByTestId('slice-button')).toBeVisible();

    // Menu → Guided start reopens it, on a fresh plate at step 1
    await app.getByTestId('menu').click();
    await app.getByTestId('menu-guided').click();
    await expect(app.getByTestId('guided-float-card')).toBeVisible();
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');

    // removing the last model reopens the flow after the model left the plate
    await importFile(app, CUBE, { clear: false });
    await expect(app.getByTestId('guided-next')).toBeEnabled();
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await settle(app, 900);
    await expect(app.getByTestId('guided-float-card')).toBeVisible();
    expect(await read(app, (s) => s.flowStep), 'the emptied plate reopened the flow').toBe(1);

    // Don't show again: the preference is off, the stored key follows, and a fresh session keeps it off
    await app.getByTestId('guided-skip').click();
    await app.getByTestId('guided-skip-never').click();
    await expect(app.getByTestId('guided-float-card')).toHaveCount(0);
    expect(await read(app, (s) => s.guidedStart), 'Don’t show again switches the preference off').toBe(false);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.guidedStart.enabled'))).toBe('off');
    const fresh = await app.context().newPage();
    await blockSessionRestore(fresh);
    await openApp(fresh);
    expect(await read(fresh, (s) => s.guidedStart), 'the fresh session starts with the preference off').toBe(false);
    expect(await read(fresh, (s) => s.flowStep), 'no flow on an empty plate with the preference off').toBeUndefined();
    await expect(fresh.getByTestId('guided-float-card')).toHaveCount(0);
    await expect(fresh.getByTestId('slice-button')).toBeVisible();
    await fresh.close();
  });

  test('the card is no wider than 520 px and fits a 1280 × 720 scene', async ({ app }) => {
    await armGuidedStart(app);
    await app.setViewportSize({ width: 1280, height: 720 });
    await settle(app, 900);
    await expectCardAndFraming(app, 'guided step 1 at 1280 × 720');
    // the step's two actions and the button row are reachable without scrolling the card's body
    for (const id of ['guided-pick', 'guided-library', 'guided-skip']) {
      const visible = await app.getByTestId(id).isVisible();
      expect(visible, `${id} is visible at 1280 × 720`).toBe(true);
    }
  });
});
