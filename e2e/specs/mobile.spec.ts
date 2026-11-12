/**
 * The companion flow on a phone and a tablet (T-091).
 *
 * The two extra projects of `playwright.config.ts` (`phone` 390 × 844 with touch, `tablet` 820 ×
 * 1180) run this file only; the desktop project ignores it. The test is the job the responsive table
 * promises for a small screen: pick a file in the Library, open the bottom sheet, choose a filament,
 * slice without scrolling anywhere, see the preview, send the G-code – plus the three rules that
 * every screen has to keep on the way:
 *
 * - nothing scrolls the page sideways (`scrollWidth <= innerWidth`),
 * - a dialog stays inside the viewport and its primary button is reachable without scrolling,
 * - the phone's tab bar has four labelled entries a finger can hit (≥ 44 px).
 *
 * The flows are driven through the DOM (the tab bar, the sheet handle, the buttons) so a broken
 * control fails the test; the store is only read.
 */
import { armGuidedStart, blockSessionRestore, CUBE, importFile, openApp, read, settle, sliceAndWait } from '../helpers/app';
import {
  angleDelta,
  bedOutline,
  cameraPose,
  cameraRig,
  frameProbe,
  lookInside,
  project as projectPoints,
  screenPoint,
  shot,
  tapCamera,
  toolpathBox,
} from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { E2E_PRINTER } from '../global-setup';
import { addPrinter, clearUploads, HAS_MOCK_HOST, removePrinters, uploads, type TestPrinter } from '../helpers/mock-host';
import {
  canvasPoint,
  centreOf,
  touchDoubleTap,
  touchDrag,
  touchDragProbed,
  touchFling,
  touchLongPress,
  touchPan,
  touchPinch,
} from '../helpers/touch';
import type { Page } from '@playwright/test';

/** The project this test is running in (`phone` or `tablet`). */
const project = () => test.info().project.name;
const isPhone = () => project() === 'phone';

/** The page never scrolls sideways – the one rule every screen on a small display has to keep. */
async function expectNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(size.scroll, `${screen} scrolls sideways (${size.scroll} > ${size.inner})`).toBeLessThanOrEqual(size.inner);
}

/** A box is inside the viewport the user actually sees (no scroll needed to reach it). */
async function expectInsideViewport(page: Page, selector: string, what: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  const view = page.viewportSize();
  expect(box, `${what} is not rendered`).toBeTruthy();
  expect(view, 'the project has a viewport').toBeTruthy();
  if (!box || !view) return;
  expect(box.y, `${what} starts above the viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what} is cut by the bottom edge`).toBeLessThanOrEqual(view.height);
  expect(box.x, `${what} starts left of the screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} is cut by the right edge`).toBeLessThanOrEqual(view.width);
}

/** Import the sample cube through the app's own input and leave nothing selected. */
async function cubeOnPlate(page: Page): Promise<void> {
  await page.locator('input[type="file"]').first().setInputFiles(CUBE);
  await page.waitForFunction(
    () => {
      const s = window.webslicer.getState();
      return s.objects.length === 1 && s.objects.every((o) => o.modelId || o.uploadError);
    },
    null,
    { timeout: 180_000 },
  );
  await page.evaluate(() => window.webslicer.getState().select([]));
  await settle(page, 1200);
  // a phone's first frames can land after the fixture's tap: take the camera once more before a
  // gesture test reads a pose through it
  await tapCamera(page);
}

/** Upload the sample cube into the open Library dialog and load it (its row closes the dialog). */
async function loadCubeFromLibrary(page: Page): Promise<void> {
  await page.locator('.library input[type="file"]').setInputFiles(CUBE);
  const row = page.locator('[data-testid="library-row"]').filter({ hasText: 'calibration_cube_20mm' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.name').click();
  await expect(page.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
}

/** The centre of the first object (on its surface, where a finger hits it). */
async function objectCentre(page: Page): Promise<[number, number, number]> {
  return read(page, (s) => {
    const o = s.objects[0];
    const i = o.instances[0];
    return [i.position[0], i.position[1], i.position[2] + o.size[2] / 2] as [number, number, number];
  });
}

test.describe('the companion flow on a small screen (T-091, T-099)', () => {
  // the send test creates a print host: server state like the send spec's own tests
  test.describe.configure({ lock: 'server-state' });

  test('an empty plate offers the library as well as the phone picker (AC-1)', async ({ app }) => {
    test.skip(!isPhone(), 'the empty-plate card is the phone layout');
    await expectNoSidewaysScroll(app, 'the empty plater');
    const card = app.getByTestId('dropzone-empty');
    await expect(card).toBeVisible();
    // both ways in are finger-sized targets and in the viewport
    for (const id of ['dropzone-pick', 'dropzone-library']) {
      await expectInsideViewport(app, `[data-testid="${id}"]`, `the ${id} button`);
      const box = await app.getByTestId(id).boundingBox();
      expect(box!.height, `${id} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
    }
    // From library is the app's one library, the dialog its rail entry opens
    await app.getByTestId('dropzone-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await loadCubeFromLibrary(app);
    // the first file onto an empty plate folds the sheet to peek, the Slice button one tap away
    await app.waitForFunction(() => window.webslicer.getState().objects.length > 0, null, { timeout: 120_000 });
    await settle(app, 1200);
    await expect(app.getByTestId('sheet-handle')).toHaveAttribute('data-sheet-state', 'peek');
    await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button after the library load');
  });

  test('Library → sheet → filament → slice → preview works without scrolling the page', async ({ app }) => {
    // the phone starts on the plater with the Slice footer in reach
    await expectNoSidewaysScroll(app, 'the plater');

    // the Library is the tab the flow starts from: upload a sample, then open it
    await app.getByTestId('rail-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await expectInsideViewport(app, '[data-testid="modal"]', 'the Library dialog');
    await expectNoSidewaysScroll(app, 'the Library');
    await loadCubeFromLibrary(app);
    await app.waitForFunction(
      () => {
        const s = window.webslicer.getState();
        return s.objects.length > 0 && s.objects.every((o) => o.modelId || o.uploadError);
      },
      null,
      { timeout: 120_000 },
    );
    await app.waitForTimeout(1000);

    // the sheet's handle is the phone's own chrome; the tap cycle walks peek → half → full → peek
    // and never lands on `hidden`, which is the drag's position alone
    if (isPhone()) {
      const handle = app.getByTestId('sheet-handle');
      await expect(handle).toBeVisible();
      // it starts folded to peek: the model keeps the scene and the Slice button sits in the footer
      await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (peek)');
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'half');
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (half sheet)');
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'full');
      await expect(app.getByTestId('context-panel')).toBeVisible();
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (full sheet)');
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
      // leave the presets in reach for the filament below
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', 'half');
    }

    // choose a filament: the panel's own select, not the store
    const filament = app.locator('[data-testid="preset-select-filament"] select').first();
    await expect(filament).toBeVisible();
    const current = await filament.inputValue();
    const options = await filament.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const other = options.find((v) => v !== current);
    expect(other, 'the fixture data offers a second filament').toBeTruthy();
    await filament.selectOption(other as string);
    await app.waitForTimeout(800);
    await expect(filament).toHaveValue(other as string);
    await expectNoSidewaysScroll(app, 'the sheet with the presets');

    // the Slice button is on screen without a scroll – click it where it is
    await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button');
    await app.getByTestId('slice-button').click();
    await app.waitForFunction(
      () => {
        const j = window.webslicer.getState().job;
        return !!j && ['done', 'error'].includes(j.status);
      },
      null,
      { timeout: 600_000 },
    );
    await app.waitForTimeout(1500);
    const job = await read(app, (s) => ({ status: s.job?.status, id: s.job?.id }));
    expect(job.status, 'the slice finished').toBe('done');
    expect(job.id).toBeTruthy();

    // the slice switches to the Preview on its own and shows the panel, not just the scene
    await expect(app.getByTestId('preview-panel')).toBeVisible({ timeout: 30_000 });
    await app.waitForTimeout(3000);
    await expectNoSidewaysScroll(app, 'the preview');
    await expect(app.getByTestId('layer-slider')).toHaveCount(1);
    if (isPhone()) {
      // the layer card is the sheet's first preview card, so the slider is on screen in the default
      // half position – the bottom sheet never takes it away
      await expect(app.getByTestId('layer-slider')).toBeInViewport();
    }
  });

  test('every dialog stays inside the viewport and its primary button is reachable', async ({ app }) => {
    const dialogs: Array<[string, unknown, string]> = [
      ['library', 'open', 'the Library dialog'],
      ['printers', { tab: 'hosts' }, 'the Printers dialog'],
      ['printers', { tab: 'vendor' }, 'the Printers dialog (vendor profiles)'],
      ['preferences', undefined, 'the Preferences dialog'],
      ['about', undefined, 'the About dialog'],
    ];
    for (const [kind, payload, name] of dialogs) {
      await app.evaluate(([k, p]) => window.webslicer.getState().openDialog(k as string, p), [kind, payload ?? null] as const);
      await expect(app.getByTestId('modal')).toBeVisible();
      await app.waitForTimeout(500);
      await expectInsideViewport(app, '[data-testid="modal"]', name);
      await expectNoSidewaysScroll(app, name);
      // the ✕ is the one action every dialog has; the primary (where one exists) must be in reach
      await expectInsideViewport(app, '[data-testid="modal-close"]', `${name}'s close button`);
      const primary = app.locator('[data-testid="modal-primary"]').first();
      if ((await primary.count()) > 0) await expectInsideViewport(app, '[data-testid="modal-primary"]', `${name}'s primary button`);
      await app.evaluate(() => window.webslicer.getState().closeDialog());
      await expect(app.getByTestId('modal')).toHaveCount(0);
    }
  });

  test('the phone tab bar has four labelled entries a finger can hit', async ({ app }) => {
    test.skip(!isPhone(), 'the bottom tab bar only exists below 640 px');
    await expectNoSidewaysScroll(app, 'the plater');
    const tabs = ['rail-slicing', 'rail-library', 'rail-printers', 'rail-more'];
    for (const id of tabs) {
      const tab = app.getByTestId(id);
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      expect(box, `${id} is rendered`).toBeTruthy();
      if (!box) continue;
      expect(box.height, `${id} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${id} is narrower than 44 px`).toBeGreaterThanOrEqual(44);
      const label = (await tab.locator('.rail-label').textContent())?.trim();
      expect(label, `${id} has a label`).toBeTruthy();
    }
    // More is a container, not a fifth place: it opens the remaining rows and closes again
    await app.getByTestId('rail-more').click();
    await expect(app.getByTestId('rail-more-menu')).toBeVisible();
    await expect(app.getByTestId('rail-preferences-more')).toBeVisible();
    await app.getByTestId('rail-preferences-more').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await app.evaluate(() => window.webslicer.getState().closeDialog());
    await expect(app.getByTestId('modal')).toHaveCount(0);

    // every top-bar icon is a finger target too
    for (const button of await app.locator('.topbar .topbar-icon, .topbar .app-menu-trigger').all()) {
      const box = await button.boundingBox();
      if (!box) continue;
      expect(box.height, 'a top bar button is shorter than 44 px').toBeGreaterThanOrEqual(44);
    }
  });

  test('the send reaches the mock print host', async ({ app, browser }) => {
    test.skip(!HAS_MOCK_HOST, 'the send test needs the mock print host – run it with `npm run e2e:docker`');
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    const job = await read(app, (s) => ({ id: s.job?.id ?? '', outputName: s.job?.outputName ?? '', status: s.job?.status }));
    expect(job.status).toBe('done');

    let created: TestPrinter[] = [];
    try {
      created = [await addPrinter(app, { name: 'Phone host', presetName: E2E_PRINTER })];
      await app.evaluate(async () => {
        const s = window.webslicer.getState();
        await s.refreshPresetLists();
        await s.refreshPhysicalPrinters();
      });
      await settle(app, 500);
      clearUploads();

      // the preview footer's Send button is the flow's own way in
      await app.evaluate(() => window.webslicer.getState().setView('preview'));
      await settle(app, 1200);
      await expectInsideViewport(app, '[data-testid="send-button"]', 'the Send button');
      await app.getByTestId('send-button').click();
      const dialog = app.getByTestId('modal');
      await expect(dialog).toBeVisible();
      await expectInsideViewport(app, '[data-testid="modal"]', 'the Send dialog');
      await expectInsideViewport(app, '[data-testid="modal-primary"]', "the Send dialog's Upload button");
      await app.getByTestId('modal-primary').click();
      await expect(dialog).toHaveCount(0, { timeout: 60_000 });
      const sent = uploads();
      expect(sent).toHaveLength(1);
      expect(sent[0].filename).toBe(job.outputName);
      expect(sent[0].bytes).toBeGreaterThan(1000);
      expect(sent[0].fields.print).toBe('false');
    } finally {
      await removePrinters(app, created);
      clearUploads();
    }
  });
});

/**
 * The room the top rows and the sheet leave for the 3D view, in viewport pixels, plus the sheet's own
 * height – the numbers the T-101 framing and sheet checks read.
 */
async function freeBand(app: Page) {
  return app.evaluate(() => {
    const canvas = document.querySelector('.viewer canvas')!.getBoundingClientRect();
    const row = document.querySelector('[data-testid="viewer-view-row"]')?.getBoundingClientRect();
    const stack = document.querySelector('.context-stack')!.getBoundingClientRect();
    return {
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      top: row ? row.bottom + 8 : canvas.y,
      bottom: stack.top - 8,
      sheetHeight: stack.height,
      viewportHeight: window.innerHeight,
    };
  });
}

/** The plate's footprint corners and every object's box, in world coordinates. */
async function sceneCorners(app: Page): Promise<{ bed: Array<[number, number, number]>; models: Array<[number, number, number]> }> {
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
 * T-101 AC-2: the plate and every model project completely into the band the top rows and the sheet
 * leave free (4 px tolerance). Returns the band so a caller can check the sheet's height too.
 */
async function expectFramedInBand(app: Page, what: string) {
  const { bed, models } = await sceneCorners(app);
  const ndc = await projectPoints(app, [...bed, ...models]);
  expect(ndc, `${what}: the camera is tapped`).not.toBeNull();
  const missing = ndc!.filter((p) => !p).length;
  expect(missing, `${what}: every corner is in front of the camera`).toBe(0);
  const band = await freeBand(app);
  const px = (v: number) => band.canvas.x + ((v + 1) / 2) * band.canvas.width;
  const py = (v: number) => band.canvas.y + ((1 - v) / 2) * band.canvas.height;
  const xs = ndc!.map((p) => px(p![0]));
  const ys = ndc!.map((p) => py(p![1]));
  expect(band.bottom, `${what}: the sheet leaves room for the scene`).toBeGreaterThan(band.top + 100);
  expect(Math.min(...ys), `${what}: nothing is hidden under the top rows`).toBeGreaterThanOrEqual(band.top - 4);
  expect(Math.max(...ys), `${what}: nothing is hidden under the sheet`).toBeLessThanOrEqual(band.bottom + 4);
  expect(Math.min(...xs), `${what}: the scene is not cut on the left`).toBeGreaterThanOrEqual(band.canvas.x - 4);
  expect(Math.max(...xs), `${what}: the scene is not cut on the right`).toBeLessThanOrEqual(band.canvas.x + band.canvas.width + 4);
  return band;
}

/**
 * T-103 AC-2: in the Preview the plate and the visible toolpaths project completely into the band
 * between the view row and the sheet (4 px tolerance) – the models are hidden once a result exists,
 * so the toolpath box stands in for them.
 */
async function expectPreviewInBand(app: Page, what: string) {
  const { bed } = await sceneCorners(app);
  const box = await toolpathBox(app);
  expect(box, `${what}: the result has toolpaths`).not.toBeNull();
  const points: Array<[number, number, number]> = [...bed];
  for (let i = 0; i < 8; i++) {
    points.push([i & 1 ? box!.max[0] : box!.min[0], i & 2 ? box!.max[1] : box!.min[1], i & 4 ? box!.max[2] : box!.min[2]]);
  }
  const ndc = await projectPoints(app, points);
  expect(ndc, `${what}: the camera is tapped`).not.toBeNull();
  expect(
    ndc!.filter((p) => !p),
    `${what}: every corner is in front of the camera`,
  ).toHaveLength(0);
  const band = await freeBand(app);
  const px = (v: number) => band.canvas.x + ((v + 1) / 2) * band.canvas.width;
  const py = (v: number) => band.canvas.y + ((1 - v) / 2) * band.canvas.height;
  const xs = ndc!.map((p) => px(p![0]));
  const ys = ndc!.map((p) => py(p![1]));
  expect(band.bottom, `${what}: the sheet leaves room for the scene`).toBeGreaterThan(band.top + 100);
  expect(Math.min(...ys), `${what}: the plate is not under the view row`).toBeGreaterThanOrEqual(band.top - 4);
  expect(Math.max(...ys), `${what}: plate and toolpaths are not under the sheet`).toBeLessThanOrEqual(band.bottom + 4);
  expect(Math.min(...xs), `${what}: the scene is not cut on the left`).toBeGreaterThanOrEqual(band.canvas.x - 4);
  expect(Math.max(...xs), `${what}: the scene is not cut on the right`).toBeLessThanOrEqual(band.canvas.x + band.canvas.width + 4);
  return band;
}

/** The plate and the model are really drawn (T-101 AC-1: not a black canvas). */
async function expectSceneDrawn(app: Page, what: string): Promise<void> {
  const a = await shot(app);
  expect(a.plateCount, `${what}: the plate is drawn (plate-coloured pixels)`).toBeGreaterThan(2000);
  expect(a.warmCount, `${what}: the model is drawn (warm pixels)`).toBeGreaterThan(300);
  const cells = a.grid.flat();
  expect(Math.max(...cells) - Math.min(...cells), `${what}: the scene is not one flat colour`).toBeGreaterThan(20);
}

/**
 * The sheet's geometry right now: its position, its own height and the scene it leaves visible (from
 * the canvas's top edge to the sheet's top edge), plus the footer's laid-out height (0 when hidden).
 */
async function sheetMetrics(app: Page) {
  return app.evaluate(() => {
    const canvas = document.querySelector('.viewer canvas')!.getBoundingClientRect();
    const sheet = document.querySelector('.context-stack')!.getBoundingClientRect();
    const footer = document.querySelector<HTMLElement>('.context-stack .context-footer');
    return {
      state: window.webslicer.getState().sheetState,
      // the position's rule hides the footer; the element stays in the DOM, so it is the layout that
      // says whether it is drawn (a display:none box has no height)
      footer: footer ? footer.getBoundingClientRect().height : 0,
      visible: sheet.top - canvas.top,
      sheet: sheet.height,
    };
  });
}

/**
 * The sheet's fourth position and its feel (T-099): dragging down from peek reaches `hidden` – the
 * grip alone, the scene all the way down – and a tap brings peek back. The tap cycle never lands on
 * `hidden`, so the Slice button cannot vanish from under a finger that only meant to fold the sheet.
 */
test.describe('the sheet moves all the way down (T-099)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the sheet is the phone layout');

  test('a drag from peek settles on hidden, and a tap brings peek back (AC-2)', async ({ app }) => {
    await cubeOnPlate(app);
    const handle = app.getByTestId('sheet-handle');
    await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
    const before = await sheetMetrics(app);

    // a slow drag down (below the fling speed): the sheet follows the finger and settles on the
    // nearest position, which from peek is hidden
    const grip = await centreOf(app, '[data-testid="sheet-handle"]');
    await touchDrag(app, grip, { x: grip.x, y: grip.y + 260 }, 10);
    await settle(app, 600);
    await expect(handle).toHaveAttribute('data-sheet-state', 'hidden');
    const after = await sheetMetrics(app);
    expect(before.state).toBe('peek');
    expect(after.state).toBe('hidden');
    expect(after.sheet, 'only the grip stays above the tab bar').toBeLessThan(before.sheet);
    // the Slice footer is the hidden position's point: it is not drawn at all
    expect(after.footer, 'the Slice footer is out of the sheet at hidden').toBe(0);
    // the scene keeps the whole room: the visible part of the canvas grows by the peek footer's height
    expect(after.visible, 'the 3D view grows when the sheet gets out of the way').toBeGreaterThan(before.visible + 100);

    // a tap on the handle brings peek back, and the Slice button is in reach again
    await handle.click();
    await app.waitForTimeout(400);
    await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
    await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button after the tap');

    // the tap cycle never lands on hidden: peek → half → full → peek
    for (const expected of ['half', 'full', 'peek']) {
      await handle.click();
      await app.waitForTimeout(400);
      await expect(handle).toHaveAttribute('data-sheet-state', expected);
    }
  });

  test('the sheet follows the finger during the drag and settles after the release (AC-7)', async ({ app }) => {
    await cubeOnPlate(app);
    const handle = app.getByTestId('sheet-handle');
    await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
    const grip = await centreOf(app, '[data-testid="sheet-handle"]');
    const samples: Array<{ finger: number; top: number }> = [];
    // the top edge's own offset from the finger: the grip's centre sits half a handle below it
    let offset: number | null = null;
    await touchDragProbed(
      app,
      grip,
      { x: grip.x, y: grip.y - 180 },
      async (point) => {
        const top = await app.evaluate(() => document.querySelector('.context-stack')!.getBoundingClientRect().top);
        offset ??= top - point.y;
        samples.push({ finger: point.y, top });
      },
      10,
    );
    await settle(app, 700);
    // every sample keeps the press's own offset within the 8 px tolerance: the finger and the
    // sheet's top edge move together, one-to-one, with no jump between positions
    expect(offset, 'the drag was sampled').not.toBeNull();
    for (const s of samples)
      expect(Math.abs(s.top - s.finger - offset!), `the sheet's top edge follows the finger (${JSON.stringify(s)})`).toBeLessThan(8);
    // and it really moved: the last sample is far above the first
    expect(samples.at(-1)!.top, 'the sheet followed the finger up').toBeLessThan(samples[0].top - 100);
    const end = await read(app, (s) => s.sheetState);
    expect(['peek', 'half', 'full'], 'the release settles on a position').toContain(end);

    // a fling up from peek ends at half or full, never back at peek or at hidden
    await app.evaluate(() => window.webslicer.getState().setSheetState('peek'));
    await app.waitForTimeout(400);
    const grip2 = await centreOf(app, '[data-testid="sheet-handle"]');
    await touchFling(app, grip2, { x: grip2.x, y: grip2.y - 140 });
    await settle(app, 700);
    expect(['half', 'full'], 'a fling up from peek opens the sheet').toContain(await read(app, (s) => s.sheetState));
  });
});

/**
 * The phone's view row (T-099, AC-8): exactly four buttons in one line over the scene – Home, Iso and
 * the two quarter turns. The turns keep the camera's elevation and distance, so from Iso they walk
 * the four isometric corners and four turns return to where they started.
 */
test.describe('the phone view row turns the model (T-099)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the four-button row is the phone layout');

  test('exactly Home, Iso, turn left, turn right – one line, and the turns keep elevation and distance (AC-8)', async ({ app }) => {
    await cubeOnPlate(app);
    const row = app.getByTestId('viewer-view-row');
    await expect(row).toBeVisible();
    const buttons = row.getByRole('button');
    await expect(buttons).toHaveCount(4);
    // the four buttons, in row order, with the whole name each one carries
    const VIEW_BUTTONS = [
      ['view-home', 'Home'],
      ['view-iso', 'Iso view'],
      ['view-turn-left', 'Turn left 90°'],
      ['view-turn-right', 'Turn right 90°'],
    ] as const;
    const ids = VIEW_BUTTONS.map(([id]) => id);
    for (const id of ids) await expect(app.getByTestId(id)).toBeVisible();
    // one line: every button shares the row's vertical band, and the row is one button tall
    const boxes = await Promise.all(ids.map((id) => app.getByTestId(id).boundingBox()));
    const boxesOk = boxes.filter((b): b is NonNullable<typeof b> => !!b);
    expect(boxesOk, 'every view button is rendered').toHaveLength(ids.length);
    const top = Math.min(...boxesOk.map((b) => b.y));
    const bottom = Math.max(...boxesOk.map((b) => b.y + b.height));
    expect(bottom - top, 'the row is one button tall').toBeLessThanOrEqual(Math.max(...boxesOk.map((b) => b.height)) + 1);
    for (const b of boxesOk) {
      expect(b.height, 'a view button is a finger target').toBeGreaterThanOrEqual(44);
      expect(b.width, 'a view button is a finger target').toBeGreaterThanOrEqual(44);
    }
    await expectInsideViewport(app, '[data-testid="viewer-view-row"]', 'the view row');
    // the named views are gone from the phone row, in the plater and in the preview
    await expect(app.getByTestId('viewer-view-bottom')).toHaveCount(0);
    await expect(app.getByTestId('viewer-view-top')).toHaveCount(0);
    // every button carries its whole name as tooltip and accessible name
    for (const [id, label] of VIEW_BUTTONS) {
      await expect(app.getByTestId(id)).toHaveAttribute('aria-label', label);
      await expect(app.getByTestId(id)).toHaveAttribute('title', /.+/);
    }

    // the camera pose before the turns: iso, then one turn keeps the elevation and the distance
    await app.getByTestId('view-iso').click();
    await settle(app, 700);
    const start = await cameraPose(app);
    const target = await read(app, (s) =>
      s.objects[0] ? { x: s.objects[0].instances[0].position[0], y: s.objects[0].instances[0].position[1] } : null,
    );
    expect(start && target).toBeTruthy();
    const measure = (p: { x: number; y: number; z: number }, t: { x: number; y: number }) => ({
      elevation: Math.hypot(p.x - t.x, p.y - t.y),
      height: p.z,
    });
    const m0 = measure(start!, target!);
    await app.getByTestId('view-turn-right').click();
    await settle(app, 700);
    const turned = await cameraPose(app);
    const m1 = measure(turned!, target!);
    expect(Math.abs(m1.height - m0.height), 'the elevation is unchanged').toBeLessThan(1);
    expect(Math.abs(m1.elevation - m0.elevation), 'the distance is unchanged').toBeLessThan(1);
    expect(Math.hypot(turned!.x - start!.x, turned!.y - start!.y), 'the camera really turned').toBeGreaterThan(3);

    // four turns return to the starting pose
    for (let i = 0; i < 3; i++) {
      await app.getByTestId('view-turn-right').click();
      await settle(app, 600);
    }
    const back = await cameraPose(app);
    expect(Math.hypot(back!.x - start!.x, back!.y - start!.y), 'four turns come back to the pose').toBeLessThan(1);
  });
});

/**
 * The 3D view by finger (T-092). Every gesture goes through the browser's own touch pipeline
 * (`helpers/touch.ts`, CDP `Input.dispatchTouchEvent`), so the viewer receives real
 * `pointerType: 'touch'` events. The checks read the store and the projected camera: "the camera
 * moved" is the pose of the last frame, "the toolpaths are framed" is their projected box.
 */
test.describe('the 3D view by finger (T-092)', () => {
  // the project is not readable outside a running test, so the skip asks the viewport: 390 px is the
  // phone, 820 px the tablet
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the gestures are the phone project’s – a tablet has no phone sheet');

  test('a tap picks the model, a tap on empty space clears it, one finger orbits the scene', async ({ app }) => {
    await cubeOnPlate(app);
    const at = await screenPoint(app, await objectCentre(app));
    expect(at, 'the cube is on screen').toBeTruthy();
    await app.touchscreen.tap(at!.x, at!.y);
    await settle(app, 400);
    expect(await read(app, (s) => s.selectedIds), 'a tap selects the model').toHaveLength(1);

    // one finger over empty scene orbits (and never selects)
    const empty = await canvasPoint(app, 0.2, 0.28);
    const before = await cameraPose(app);
    await touchDrag(app, empty, { x: empty.x + 110, y: empty.y + 40 });
    await settle(app, 500);
    const orbited = await cameraPose(app);
    expect(before && orbited, 'the camera is tapped').toBeTruthy();
    expect(
      Math.hypot(orbited!.x - before!.x, orbited!.y - before!.y, orbited!.z - before!.z),
      'one finger orbits the camera',
    ).toBeGreaterThan(3);
    expect(await read(app, (s) => s.selectedIds), 'an orbit does not change the selection').toHaveLength(1);

    // a tap on the empty plate clears the selection, like a click on the floor
    await app.touchscreen.tap(empty.x, empty.y);
    await settle(app, 400);
    expect(await read(app, (s) => s.selectedIds), 'a tap on empty space deselects').toEqual([]);
  });

  test('two fingers zoom, and a double tap frames the whole plate again', async ({ app }) => {
    await cubeOnPlate(app);
    // the pose the double tap has to give back: the Home button's own frame (T-101 frames plate and
    // objects after an import, which is a little wider than the plate alone)
    await app.getByTestId('view-home').click();
    await settle(app, 700);
    await tapCamera(app);
    const home = await frameProbe(app);
    expect(home.objects, 'the cube is projected before the gesture').not.toBeNull();
    // an empty spot of the scene, clear of the model and its gizmo: T-101 frames the model into the
    // band above the sheet, so the canvas' own centre now holds it – a tap there belongs to the gizmo
    const centre = await canvasPoint(app, 0.25, 0.45);

    // two fingers moving apart zoom in: the bed grows in the picture. The objects' box cannot show it –
    // `frameProbe` projects one centre per instance, so a single cube is a point with no span – the
    // bed's four corners do, the same measure the camera spec uses for "zoom to selection".
    await touchPinch(app, centre, 70, 220);
    await settle(app, 600);
    const pinched = await frameProbe(app);
    const span = (f: typeof home) => (f.bed ? Math.max(Math.abs(f.bed[2] - f.bed[0]), Math.abs(f.bed[3] - f.bed[1])) : 0);
    expect(span(home), 'the bed is projected before the gesture').toBeGreaterThan(0);
    expect(span(pinched), 'two fingers moving apart zoom in').toBeGreaterThan(span(home) * 1.15);

    // a double tap frames everything again: the same command as Home, so the bed is back exactly
    // where the Home button leaves it
    await touchDoubleTap(app, centre);
    await settle(app, 700);
    const framed = await frameProbe(app);
    expect(framed.bed, 'the bed is framed after the double tap').not.toBeNull();
    expect(framed.bed?.[0], 'framed left').toBeCloseTo(home.bed?.[0] ?? NaN, 1);
    expect(framed.bed?.[2], 'framed right').toBeCloseTo(home.bed?.[2] ?? NaN, 1);
  });

  test('a long press offers the object’s actions, and Duplicate is one tap', async ({ app }) => {
    await cubeOnPlate(app);
    const at = await screenPoint(app, await objectCentre(app));
    expect(at, 'the cube is on screen').toBeTruthy();
    await touchLongPress(app, { x: at!.x, y: at!.y });
    await expect(app.getByTestId('touch-menu')).toBeVisible();
    await app.getByTestId('touch-menu-duplicate').tap();
    await expect(app.getByTestId('touch-menu')).toHaveCount(0);
    await settle(app, 900);
    // a duplicate is the plater's own command: a second object on the plate, not a second instance
    expect(await read(app, (s) => s.objects.length), 'the duplicate landed').toBe(2);
  });

  test('a selected object follows the finger to another place on the plate', async ({ app }) => {
    await cubeOnPlate(app);
    const at = await screenPoint(app, await objectCentre(app));
    expect(at, 'the cube is on screen').toBeTruthy();
    await app.touchscreen.tap(at!.x, at!.y);
    await settle(app, 400);
    const start = await read(app, (s) => s.objects[0].instances[0].position);
    await touchDrag(app, { x: at!.x, y: at!.y }, { x: at!.x + 64, y: at!.y + 32 });
    await settle(app, 700);
    const moved = await read(app, (s) => s.objects[0].instances[0].position);
    expect(Math.hypot(moved[0] - start[0], moved[1] - start[1]), 'the object moved with the finger').toBeGreaterThan(3);
  });

  test('the canvas keeps the page still: no pinch zoom of the page, no pull-to-refresh', async ({ app }) => {
    const styles = await app.evaluate(() => {
      const canvas = document.querySelector('.viewer canvas') as HTMLElement;
      return {
        canvasTouchAction: getComputedStyle(canvas).touchAction,
        viewerOverscroll: getComputedStyle(document.querySelector('.viewer') as HTMLElement).overscrollBehavior,
        bodyOverscroll: getComputedStyle(document.body).overscrollBehavior,
        scrollBefore: [window.scrollX, window.scrollY],
      };
    });
    expect(styles.canvasTouchAction, 'the canvas takes every finger (AC-4)').toBe('none');
    expect(styles.viewerOverscroll, 'the scene never rubber-bands (AC-4)').toBe('none');
    expect(styles.bodyOverscroll, 'the page never pulls to refresh (AC-4)').toBe('none');
  });
});

/**
 * The preview on a phone (T-092): one-tap views that really frame the toolpaths, the layer slider by
 * touch, the folded legend and the result line in the peek sheet.
 *
 * The framing finding of `.ai/FINDINGS.md` (the view bar's Iso and the keys 0/Z not framing the
 * toolpaths in the preview) is asserted here on the *camera target*, not on pixels: after a view the
 * target sits at the centre of the visible toolpaths' bounding box.
 */
test.describe('the preview on a phone (T-092)', () => {
  test.describe.configure({ lock: 'server-state' });

  test('the Preview bed keeps its surface and grid after slicing (T-103 AC-1)', async ({ app }) => {
    test.skip(!isPhone(), 'the phone preview is the sheet layout of a 390 px screen');
    // the page slices for itself: the bug came from the texture probe that runs while a slice's
    // G-code is built, and a job loaded from the server never runs it (T-103)
    await importFile(app, CUBE);
    await sliceAndWait(app);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1800);
    // measure inside the plate's projected outline: the background and the dark UI around it cannot
    // stand in for the surface, and a bed that has gone black is one flat near-zero picture
    const { outline } = await bedOutline(app);
    expect(outline, 'the plate has an outline to measure').not.toBeNull();
    const ndc = await projectPoints(
      app,
      outline!.map(([x, y]) => [x, y, 0] as [number, number, number]),
    );
    expect(ndc, 'the camera is tapped').not.toBeNull();
    const look = await lookInside(
      app,
      ndc!.filter((p): p is [number, number] => !!p),
    );
    expect(look.pixels, 'the plate covers a measurable area').toBeGreaterThan(3000);
    expect(look.mean, 'the bed shows its surface and grid (not black)').toBeGreaterThan(35);
    expect(look.dark, 'the bed is not one flat black surface').toBeLessThan(0.5);
  });

  test('the Preview frames plate and toolpaths in the band, and a finger orbit ends the automatic framing (T-103 AC-2)', async ({
    app,
    browser,
  }) => {
    test.skip(!isPhone(), 'the phone preview is the sheet layout of a 390 px screen');
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setView('preview');
      s.setSheetState('peek');
    });
    // the automatic framing measures the band after the sheet's 180 ms transition (240 ms settle)
    await settle(app, 1600);
    await expectPreviewInBand(app, 'the Preview at peek');

    // a finger on the scene is the user's own view: nothing frames it back afterwards
    const empty = await canvasPoint(app, 0.18, 0.42);
    await touchDrag(app, empty, { x: empty.x + 70, y: empty.y + 30 });
    await settle(app, 500);
    const orbited = await cameraPose(app);
    await settle(app, 900);
    const later = await cameraPose(app);
    expect(orbited && later, 'the camera is tapped').toBeTruthy();
    expect(
      Math.hypot(later!.x - orbited!.x, later!.y - orbited!.y, later!.z - orbited!.z),
      'nothing reframes after the gesture',
    ).toBeLessThan(0.5);
  });

  test('Home and Iso frame the toolpaths, the turns keep the framing, and the layer slider moves by touch (T-092, T-099)', async ({
    app,
    browser,
  }) => {
    test.skip(!isPhone(), 'the phone preview is the sheet layout of a 390 px screen');
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1500);
    await tapCamera(app);
    const box = await toolpathBox(app);
    expect(box, 'the preview has toolpaths').toBeTruthy();
    const middle: [number, number, number] = [0, 1, 2].map((i) => (box!.min[i] + box!.max[i]) / 2) as [number, number, number];
    // the eight corners: their projection says how much of the picture the toolpaths fill
    const corners: Array<[number, number, number]> = [];
    for (let i = 0; i < 8; i++) {
      corners.push([i & 1 ? box!.max[0] : box!.min[0], i & 2 ? box!.max[1] : box!.min[1], i & 4 ? box!.max[2] : box!.min[2]]);
    }

    // T-099: the phone row is Home, Iso and the two turns; the named views are not on it any more
    const views = [
      ['view-iso', 'Iso'],
      ['view-turn-right', 'turn right'],
      ['view-turn-right', 'turn right again'],
      ['view-turn-left', 'turn left'],
    ] as const;
    for (const [id, name] of views) {
      await app.getByTestId(id).click();
      await settle(app, 900);
      // the toolpaths' centre sits at the centre of the free band (T-101: on a phone the view is
      // framed into the room above the sheet, not into the whole canvas), and their box fills the
      // band – a fallback to the whole bed would centre the plate and leave the print small
      const band = await freeBand(app);
      const [onScreen] = (await projectPoints(app, [middle])) ?? [null];
      expect(onScreen, `${name} keeps the toolpaths in view`).not.toBeNull();
      expect(Math.abs(onScreen![0]), `${name} centres the toolpaths horizontally`).toBeLessThan(0.2);
      const centreY = band.canvas.y + ((1 - onScreen![1]) / 2) * band.canvas.height;
      expect(
        Math.abs(centreY - (band.top + band.bottom) / 2),
        `${name} centres the toolpaths in the band (${Math.round(centreY)} px, band ${band.top}…${band.bottom})`,
      ).toBeLessThan(12);
      const projected = (await projectPoints(app, corners)) ?? [];
      const xs = projected.filter((p): p is [number, number] => !!p).map((p) => p[0]);
      const ys = projected.filter((p): p is [number, number] => !!p).map((p) => p[1]);
      expect(
        Math.max(...xs) - Math.min(...xs) > 0.5 || Math.max(...ys) - Math.min(...ys) > 0.5,
        `${name} fills the picture with the toolpaths`,
      ).toBe(true);
    }
    // Home frames the whole plate again
    await app.getByTestId('view-home').click();
    await settle(app, 900);
    // the layer slider is a 44 px touch target and moves the visible layer range with a finger drag.
    // The preview opens in the peek sheet, where the card is folded away, so one tap on the handle
    // brings the preview card (and its slider) into reach first.
    await app.getByTestId('sheet-handle').click();
    await settle(app, 700);
    await expect(app.getByTestId('sheet-handle')).toHaveAttribute('data-sheet-state', 'half');
    const slider = app.getByTestId('layer-slider');
    await expect(slider).toBeVisible();
    const thumb = await slider.boundingBox();
    expect(thumb, 'the layer slider is rendered').toBeTruthy();
    expect(thumb!.height, 'the slider is a finger-sized target (AC-2)').toBeGreaterThanOrEqual(44);
    const top = await read(app, (s) => s.previewLayerRange[1]);
    const handle = await centreOf(app, '[data-testid="layer-slider"]');
    await touchDrag(app, { x: thumb!.x + thumb!.width - 4, y: handle.y }, { x: handle.x, y: handle.y });
    await settle(app, 600);
    expect(await read(app, (s) => s.previewLayerRange[1]), 'the slider moved by touch').toBeLessThan(top);
  });

  test('the result sits in the peek sheet, one tap from Send', async ({ app, browser }) => {
    test.skip(!isPhone(), 'the peek sheet is the phone layout');
    const sharedJob = await sliceOnce(browser);
    await openSharedSlice(app, sharedJob);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setView('preview');
      s.setSheetState('peek');
    });
    await settle(app, 1200);
    // the peek sheet is the footer: the result line and the actions, both on screen
    await expect(app.getByTestId('phone-result')).toBeVisible();
    await expectInsideViewport(app, '[data-testid="phone-result"]', 'the slice result');
    await expectInsideViewport(app, '[data-testid="send-button"]', 'the Send button');
    await expectNoSidewaysScroll(app, 'the peek sheet');
    await expect(app.getByTestId('sheet-handle')).toHaveAttribute('data-sheet-state', 'peek');

    // R-05: the Details chip is in the peek row, so it is found without opening the sheet: one tap
    // opens the sliced info and the legend
    const details = app.getByTestId('preview-info-toggle');
    await expect(details).toBeVisible();
    await expectInsideViewport(app, '[data-testid="preview-info-toggle"]', 'the Details chip');
    await expect(details).toContainText('Details');
    // the chip's own row is a finger target
    const chip = await details.boundingBox();
    expect(chip!.height, 'the Details chip is shorter than 44 px').toBeGreaterThanOrEqual(44);
    await expect(app.getByTestId('preview-info-stats')).toHaveCount(0);
    await details.click();
    await settle(app, 500);
    await expect(details).toHaveAttribute('aria-expanded', 'true');
    await expect(app.getByTestId('preview-info-stats')).toBeVisible();
    // the legend the chip opened (the left column's card is a drawer here and has its own)
    await expect(app.getByTestId('preview-info').getByTestId('legend')).toBeVisible();
    // the opened body is inside the sheet, so nothing it holds widens the 390 px page
    await expectNoSidewaysScroll(app, 'the Details body');
    // and the same tap folds it again
    await details.click();
    await settle(app, 400);
    await expect(details).toHaveAttribute('aria-expanded', 'false');
  });
});

/**
 * Orientation (T-092, AC-3): portrait is the design target, but a phone turned on its side (844 × 390)
 * must not break – no sideways scroll, no clipped footer, and the Slice button still one tap away.
 */
test.describe('a phone in landscape (T-092)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the landscape check turns the phone project sideways');

  test('844 × 390 keeps the page still and the Slice button in reach', async ({ app }) => {
    await app.setViewportSize({ width: 844, height: 390 });
    await settle(app, 800);
    await expectNoSidewaysScroll(app, 'landscape');
    await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (landscape)');
    const overflow = await app.evaluate(() => {
      const width = window.innerWidth;
      return Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.right > width + 1 && getComputedStyle(el).position !== 'fixed';
        })
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    });
    expect(overflow, 'no element sticks out of the landscape viewport').toEqual([]);

    // 844 px wide is past the phone breakpoint (640 px), so there is no bottom sheet to fold: the
    // context panel is the wide layout's card, and it keeps the Slice button on screen without a tap
    await expect(app.getByTestId('sheet-handle')).toHaveCount(0);
    await expect(app.getByTestId('context-panel')).toBeVisible();
    await expectInsideViewport(app, '[data-testid="context-panel"]', 'the context panel (landscape)');
    await expectNoSidewaysScroll(app, 'landscape with the panels');
  });
});

/**
 * The guided start (T-100): a fresh phone plate opens a four-step flow from the model to the print,
 * the empty footer stays quiet until there is something to send or slice, and More → Guided start is
 * the way back in. The flow is a second path through the same controls – the library dialog, the
 * preset rows, the quick settings, the destination and the Slice button – so these tests drive them
 * through the DOM and only read the store.
 */
test.describe('the guided start on a phone (T-100)', () => {
  // the walk creates a print host for its Send step: server state like the send spec's own tests
  test.describe.configure({ lock: 'server-state' });

  /** The step's own checks: no sideways scroll, 44 px targets, every control named, a heading. */
  async function checkStep(page: Page, screen: string, ids: string[]): Promise<void> {
    await expectNoSidewaysScroll(page, screen);
    for (const id of ids) {
      const el = page.getByTestId(id).first();
      if ((await el.count()) === 0) continue;
      await expectInsideViewport(page, `[data-testid="${id}"]`, `${screen}'s ${id}`);
      const box = await el.boundingBox();
      expect(box, `${screen}: ${id} is rendered`).toBeTruthy();
      expect(box!.height, `${screen}: ${id} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
    }
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const card = document.querySelector('[data-testid="guided-card"]');
      const header = document.querySelector('[data-testid="guided-header"]');
      if (!card) return ['the guided card is not drawn'];
      if (!card.getAttribute('aria-label')) out.push('the card has no accessible label');
      if (!header?.querySelector('h2')) out.push('the step has no heading');
      if (
        !document
          .querySelector('[data-testid="guided-step"]')
          ?.textContent?.trim()
          .match(/^[1-4] \/ 4$/)
      )
        out.push('the "n / 4" counter is missing');
      const name = (el: HTMLElement) => {
        const labels = (el as HTMLInputElement).labels;
        return (el.getAttribute('aria-label') || el.getAttribute('title') || labels?.[0]?.textContent || el.textContent || '').trim();
      };
      const controls = document.querySelectorAll<HTMLElement>(
        '[data-testid="guided-card"] button, [data-testid="guided-card"] input, [data-testid="guided-card"] select, ' +
          '[data-testid="guided-nav"] button, [data-testid="context-footer"] select',
      );
      for (const el of Array.from(controls)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (!name(el)) out.push(`${el.tagName.toLowerCase()}.${el.className} has no accessible name`);
      }
      // every control the flow puts in reach is a thumb target (AC-7): the step's own buttons, the
      // preset and quick-setting selects, the destination's select and the Slice button
      const areas = ['[data-testid="guided-card"]', '[data-testid="guided-nav"]', '[data-testid="context-footer"]']
        .map((sel) => document.querySelector(sel))
        .filter((el): el is Element => !!el);
      for (const area of areas) {
        for (const el of Array.from(area.querySelectorAll<HTMLElement>('button, select, input'))) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.height < 44) out.push(`${el.tagName.toLowerCase()}.${el.className} is ${Math.round(r.height)} px tall`);
        }
      }
      return out;
    });
    expect(problems, `${screen}: accessible names and the step's heading`).toEqual([]);
  }

  test('a fresh phone opens step 1, and the empty footer is quiet (AC-2)', async ({ app }) => {
    test.skip(!isPhone(), 'the guided flow is the phone layout');
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-card')).toBeVisible();
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
    await expect(app.getByTestId('guided-header')).toContainText('Pick a model');
    // T-103 AC-3: the empty plate lies completely in the room the card leaves. The reload swapped
    // the renderer, so take the camera before projecting through it.
    await settle(app, 1200);
    await tapCamera(app);
    await expectFramedInBand(app, 'guided step 1');
    await checkStep(app, 'guided step 1', ['guided-pick', 'guided-library', 'guided-next', 'guided-skip']);
    // step 1 carries the two ways in, so the scene's card is not drawn a second time
    await expect(app.getByTestId('dropzone-empty')).toHaveCount(0);
    await expect(app.getByTestId('guided-file')).toHaveCount(0);
    await expect(app.getByTestId('guided-back')).toHaveCount(0);
    await expect(app.getByTestId('guided-next')).toBeDisabled();
    await expect(app.getByTestId('guided-skip')).toHaveText('Skip guided start');
    // the quiet footer: an empty plate has nothing to send and nothing to slice
    await expect(app.getByTestId('destination')).toHaveCount(0);
    await expect(app.getByTestId('slice-panel')).toHaveCount(0);
    await expect(app.getByTestId('slice-button')).toHaveCount(0);
  });

  test('the four steps carry a model to a slice, and the changed setting reaches the job (AC-3, AC-7)', async ({ app }) => {
    test.skip(!isPhone(), 'the guided flow is the phone layout');
    let created: TestPrinter[] = [];
    try {
      if (HAS_MOCK_HOST) {
        created = [await addPrinter(app, { name: 'Guided host', presetName: E2E_PRINTER })];
        await app.evaluate(async () => {
          const s = window.webslicer.getState();
          await s.refreshPresetLists();
          await s.refreshPhysicalPrinters();
        });
        clearUploads();
      }
      await armGuidedStart(app);
      // step 1: the app's one library dialog is the flow's way to a model
      await app.getByTestId('guided-library').click();
      await expect(app.getByTestId('modal')).toBeVisible();
      await loadCubeFromLibrary(app);
      await expect(app.getByTestId('guided-file')).toContainText('calibration_cube_20mm');
      await expect(app.getByTestId('guided-next')).toBeEnabled();
      await app.getByTestId('guided-next').click();

      // step 2: the same three preset rows the panel shows
      await expect(app.getByTestId('guided-step')).toHaveText('2 / 4');
      await expect(app.getByTestId('guided-header')).toContainText('Printer and profiles');
      // AC-3: pick each row – the same three selects the panel's preset card shows. The printer is
      // the fixture's own, so the later summary and the sliced G-code start from a known profile.
      for (const type of ['printer', 'filament', 'print'] as const) {
        const select = app.locator(`[data-testid="preset-select-${type}"] select`).first();
        await expect(select).toBeVisible();
        const current = await select.inputValue();
        const options = await select
          .locator('option')
          .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => !!v && v !== 'printersVendor'));
        const wanted = type === 'printer' ? E2E_PRINTER : current || options[0] || '';
        expect(options, `the fixture offers the ${type} preset`).toContain(wanted);
        await select.selectOption(wanted);
        await settle(app, 800);
        await expect(select).toHaveValue(wanted);
      }
      await checkStep(app, 'guided step 2', ['guided-back', 'guided-next', 'guided-skip']);
      await app.getByTestId('guided-next').click();

      // step 3: "Fine as it is?" plus the quick settings; one value changed by the user
      await expect(app.getByTestId('guided-step')).toHaveText('3 / 4');
      await expect(app.getByTestId('guided-card')).toContainText('Fine as it is? Just continue.');
      await expect(app.getByTestId('quick-density')).toBeVisible();
      await app.getByTestId('quick-density').selectOption('40%');
      await settle(app, 900);
      expect(await read(app, (s) => s.presets.print.current.fill_density)).toBe('40%');
      await checkStep(app, 'guided step 3', ['guided-back', 'guided-next', 'guided-skip']);
      await app.getByTestId('guided-next').click();

      // step 4: the summary, then the free layout's own destination and Slice button
      await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');
      await expect(app.getByTestId('guided-summary')).toBeVisible();
      await expect(app.getByTestId('guided-summary')).toContainText(E2E_PRINTER);
      await expect(app.getByTestId('guided-next')).toHaveCount(0);
      await expect(app.getByTestId('guided-skip')).toHaveText('More settings');
      await expect(app.getByTestId('destination')).toBeVisible();
      await expect(app.getByTestId('slice-button')).toBeVisible();
      await checkStep(app, 'guided step 4', ['guided-back', 'guided-skip', 'slice-button']);

      await app.getByTestId('slice-button').click();
      await app.waitForFunction(
        () => {
          const j = window.webslicer.getState().job;
          return !!j && ['done', 'error'].includes(j.status);
        },
        null,
        { timeout: 600_000 },
      );
      const job = await read(app, (s) => ({ id: s.job?.id ?? '', status: s.job?.status }));
      expect(job.status, 'the guided slice finished').toBe('done');
      const gcode = await app.evaluate(async (id) => (await fetch(`/api/jobs/${id}/gcode`)).text(), job.id);
      expect(gcode, 'the quick setting reached the sliced job').toMatch(/fill_density\s*=\s*40%/);

      // the slice opens the preview: the result line and Send sit in the peek sheet
      await expect(app.getByTestId('phone-result')).toBeVisible({ timeout: 30_000 });
      await expectInsideViewport(app, '[data-testid="send-button"]', 'Send after the guided slice');
      if (HAS_MOCK_HOST) {
        await app.getByTestId('send-button').click();
        await expect(app.getByTestId('modal')).toBeVisible();
        await app.getByTestId('modal-primary').click();
        await expect(app.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
        const sent = uploads();
        expect(sent, 'the guided flow sent the job').toHaveLength(1);
        expect(sent[0].bytes).toBeGreaterThan(1000);
      }
    } finally {
      if (created.length) await removePrinters(app, created);
      clearUploads();
    }
  });

  test('Skip asks about next time: Yes keeps the flow, Don’t show again turns it off (AC-6)', async ({ app }) => {
    test.skip(!isPhone(), 'the guided flow is the phone layout');
    await armGuidedStart(app);
    await app.getByTestId('guided-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await loadCubeFromLibrary(app);
    await app.getByTestId('guided-next').click();
    await expect(app.getByTestId('guided-step')).toHaveText('2 / 4');
    // Skip opens the question in place of the row; both answers are finger-sized and either leaves
    await app.getByTestId('guided-skip').click();
    const question = app.getByTestId('guided-skip-question');
    await expect(question).toBeVisible();
    await expect(question).toContainText('Show the guided start next time?');
    for (const id of ['guided-skip-yes', 'guided-skip-never']) {
      const box = await app.getByTestId(id).boundingBox();
      expect(box, `${id} is rendered`).toBeTruthy();
      expect(box!.height, `${id} is a finger target`).toBeGreaterThanOrEqual(44);
    }
    // Yes: back to the free layout, the preference stays on
    await app.getByTestId('guided-skip-yes').click();
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    expect(await read(app, (s) => s.flowStep), 'Yes closed the flow').toBeUndefined();
    expect(await read(app, (s) => s.guidedStart), 'Yes keeps the preference on').toBe(true);
    expect(await read(app, (s) => s.flowDismissed), 'Yes asks again on the next empty plate').toBe(false);
    await expect(app.getByTestId('slice-button')).toBeVisible();

    // a fresh session with the preference on opens it again
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-card')).toBeVisible();
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
    await app.getByTestId('guided-skip').click();
    await app.getByTestId('guided-skip-never').click();
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    expect(await read(app, (s) => s.guidedStart), 'Don’t show again switches the preference off').toBe(false);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.guidedStart')), 'the choice is remembered').toBe('off');
    // the same preference over a fresh session (a new page of the context, so no earlier init script
    // can override it): no flow on the empty plate
    const fresh = await app.context().newPage();
    await blockSessionRestore(fresh);
    await openApp(fresh);
    expect(await read(fresh, (s) => s.guidedStart), 'the fresh session starts with the preference off').toBe(false);
    expect(await read(fresh, (s) => s.flowStep), 'no flow on an empty plate with the preference off').toBeUndefined();
    await expect(fresh.getByTestId('guided-card')).toHaveCount(0);
    await expect(fresh.getByTestId('dropzone-empty')).toBeVisible();
    await fresh.close();

    // More → Guided start still opens it, and its Skip asks its own question again
    await app.getByTestId('rail-more').click();
    await app.getByTestId('rail-guided-more').click();
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
  });

  test('the preference turns the flow off, and an empty phone plate stays quiet (AC-5)', async ({ app }) => {
    test.skip(!isPhone(), 'the guided flow is the phone layout');
    // the fixture starts with the guided start off: no flow, the scene's card and a quiet footer
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    await expect(app.getByTestId('dropzone-empty')).toBeVisible();
    // the two model actions of T-099 are the empty plate's way in
    await expect(app.getByTestId('dropzone-pick')).toBeVisible();
    await expect(app.getByTestId('dropzone-library')).toBeVisible();
    await expect(app.getByTestId('destination')).toHaveCount(0);
    await expect(app.getByTestId('slice-panel')).toHaveCount(0);
    // the preference is a Preferences row and it is off
    await app.getByTestId('rail-more').click();
    await app.getByTestId('rail-preferences-more').click();
    const toggle = app.getByTestId('preferences-guided-start');
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    // turning it on is remembered for the next fresh start, without changing the current plate
    await toggle.check();
    await app.evaluate(() => window.webslicer.getState().closeDialog());
    expect(await read(app, (s) => s.guidedStart)).toBe(true);
    expect(await app.evaluate(() => localStorage.getItem('webslicer.guidedStart'))).toBe('on');
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
  });

  test('a tablet keeps the free layout and never opens the flow (AC-6)', async ({ app }) => {
    test.skip(isPhone(), 'the tablet is the second project this file runs');
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    expect(await read(app, (s) => s.flowStep), 'no step off the phone').toBeUndefined();
    await expect(app.getByTestId('sheet-handle')).toHaveCount(0);
    await expect(app.getByTestId('context-panel')).toBeVisible();
    await expect(app.getByTestId('slice-button')).toBeVisible();
  });

  test('844 × 390 landscape leaves the flow closed instead of squeezing it (AC-7)', async ({ app }) => {
    test.skip(!isPhone(), 'the landscape check turns the phone project sideways');
    await armGuidedStart(app);
    await app.setViewportSize({ width: 844, height: 390 });
    await settle(app, 800);
    await expectNoSidewaysScroll(app, 'guided landscape');
    // 844 px is past the 640 px phone breakpoint: the wide layout, not a squeezed flow
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    await expect(app.getByTestId('sheet-handle')).toHaveCount(0);
    await expect(app.getByTestId('slice-button')).toBeVisible();
  });
});

/**
 * The phone retest's fixes (T-101): the model stays visible above the sheet, the flow sheet takes its
 * own height and folds to `hidden`, a turn levels the horizon, an empty plate reopens the flow, and a
 * slice leaves the flow alive across the switch to the Preview. The pixel checks read the canvas
 * screenshot; the framing checks project the real plate and object corners through the live camera.
 */
test.describe('the retest fixes on a phone (T-101)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 640, 'the fixes are the phone layout');
  // the guided-slice test creates a print host: server state like the send spec's own tests
  test.describe.configure({ lock: 'server-state' });

  /**
   * The changed footer's accessibility pass (T-101 AC-9, the same self-written check as the flow's
   * steps in T-100 – this repo has no axe-core): every visible control of the footer has an
   * accessible name and is a thumb target.
   */
  async function checkFooter(page: Page, screen: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      const el = page.getByTestId(id).first();
      if ((await el.count()) === 0) continue;
      await expect(el).toBeInViewport();
      const box = await el.boundingBox();
      expect(box, `${screen}: ${id} is rendered`).toBeTruthy();
      expect(box!.height, `${screen}: ${id} is shorter than 44 px`).toBeGreaterThanOrEqual(44);
    }
    const problems = await page.evaluate(() => {
      const out: string[] = [];
      const name = (el: HTMLElement) => {
        const labels = (el as HTMLInputElement).labels;
        return (el.getAttribute('aria-label') || el.getAttribute('title') || labels?.[0]?.textContent || el.textContent || '').trim();
      };
      const footer = document.querySelector('[data-testid="context-footer"]');
      if (!footer) return ['the footer is not drawn'];
      for (const el of Array.from(footer.querySelectorAll<HTMLElement>('button, select, input'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (!name(el)) out.push(`${el.tagName.toLowerCase()}.${el.className} has no accessible name`);
        if (r.height < 44) out.push(`${el.tagName.toLowerCase()}.${el.className} is ${Math.round(r.height)} px tall`);
      }
      return out;
    });
    expect(problems, `${screen}: accessible names and finger targets`).toEqual([]);
  }

  test('an import lands centred and drawn, and removing it reopens the flow (AC-1, AC-5)', async ({ app }) => {
    await armGuidedStart(app);
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
    const bedCentre = async () =>
      app.evaluate(() => {
        const shape = (window.webslicer.getState().presets.printer.current.bed_shape || '0x0,200x0,200x200,0x200').split(',');
        const pts = shape.map((p) => p.split('x').map(Number));
        return {
          x: (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2,
          y: (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2,
        };
      });
    const placedAt = () => read(app, (s) => ({ x: s.objects[0].instances[0].position[0], y: s.objects[0].instances[0].position[1] }));

    // the device's file picker, from step 1
    await importFile(app, CUBE);
    await settle(app, 1500);
    await expect(app.getByTestId('guided-file')).toContainText('calibration_cube_20mm');
    let centre = await bedCentre();
    let at = await placedAt();
    expect(Math.hypot(at.x - centre.x, at.y - centre.y), 'a first import in the flow lands on the plate centre').toBeLessThan(1);
    await tapCamera(app);
    await expectSceneDrawn(app, 'the plater after the device import');

    // leave the flow, then remove the last model: the flow opens again on the empty plate
    await app.getByTestId('guided-skip').click();
    await app.getByTestId('guided-skip-yes').click();
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await expect(app.getByTestId('guided-card')).toBeVisible({ timeout: 10_000 });
    await expect(app.getByTestId('guided-step')).toHaveText('1 / 4');
    await expect(app.getByTestId('guided-pick')).toBeVisible();
    expect(await read(app, (s) => s.flowStep), 'the empty plate starts the flow').toBe(1);

    // the library is the second way in, and it lands centred too
    await app.getByTestId('guided-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await loadCubeFromLibrary(app);
    await settle(app, 1500);
    centre = await bedCentre();
    at = await placedAt();
    expect(Math.hypot(at.x - centre.x, at.y - centre.y), 'the library import lands on the plate centre').toBeLessThan(1);
    await tapCamera(app);
    await expectSceneDrawn(app, 'the plater after the library import');

    // preference off: the same removal does not open the flow
    await app.getByTestId('guided-skip').click();
    await app.getByTestId('guided-skip-yes').click();
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    await app.evaluate(() => window.webslicer.getState().setGuidedStart(false));
    await app.evaluate(() => window.webslicer.getState().clearObjects());
    await settle(app, 1200);
    await expect(app.getByTestId('guided-card')).toHaveCount(0);
    expect(await read(app, (s) => s.flowStep), 'the preference off keeps the flow closed').toBeUndefined();
    await expect(app.getByTestId('dropzone-empty')).toBeVisible();
  });

  test('each step frames plate and model above the sheet, the sheet stays under 45 %, and it folds to hidden (AC-2, AC-3)', async ({
    app,
  }) => {
    await armGuidedStart(app);
    await importFile(app, CUBE);
    await settle(app, 1500);
    for (const step of [1, 2, 3, 4] as const) {
      await expect(app.getByTestId('guided-step')).toHaveText(`${step} / 4`);
      await settle(app, 1200);
      await tapCamera(app);
      const band = await expectFramedInBand(app, `guided step ${step}`);
      expect(band.sheetHeight, `step ${step}: the sheet stays at most 45 % of the viewport`).toBeLessThanOrEqual(
        band.viewportHeight * 0.45 + 1,
      );
      if (step < 4) await app.getByTestId('guided-next').click();
    }

    // AC-3: the flow's sheet is a normal sheet – dragging down reaches hidden, a tap brings it back
    const handle = app.getByTestId('sheet-handle');
    await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
    const grip = await centreOf(app, '[data-testid="sheet-handle"]');
    await touchDrag(app, grip, { x: grip.x, y: grip.y + 300 }, 10);
    await settle(app, 600);
    await expect(handle).toHaveAttribute('data-sheet-state', 'hidden');
    await expect(app.getByTestId('guided-card')).not.toBeVisible();
    expect(await read(app, (s) => s.flowStep), 'the fold does not change the step').toBe(4);
    await handle.click();
    await settle(app, 600);
    await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
    await expect(app.getByTestId('guided-card')).toBeVisible();
    await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');
  });

  test('a turn levels the horizon from Home, from Iso, after an orbit and after a pan (AC-4)', async ({ app }) => {
    await importFile(app, CUBE);
    await settle(app, 1200);

    /** One turn right: +90° around +Z, with the horizon level and everything else where it was. */
    async function turnRight(what: string) {
      await tapCamera(app);
      const before = await cameraRig(app);
      expect(before, `${what}: the camera rig is readable`).toBeTruthy();
      await app.getByTestId('view-turn-right').click();
      await settle(app, 800);
      await tapCamera(app);
      const after = await cameraRig(app);
      expect(after, `${what}: the camera rig is readable after the turn`).toBeTruthy();
      // up is +Z: the horizon is level
      expect(after!.up[0], `${what}: up has no x`).toBeCloseTo(0, 3);
      expect(after!.up[1], `${what}: up has no y`).toBeCloseTo(0, 3);
      expect(after!.up[2], `${what}: up is +Z`).toBeGreaterThan(0.999);
      // exactly a quarter turn around the vertical axis through the same target
      expect(Math.abs(angleDelta(after!.azimuth, before!.azimuth) - 90), `${what}: the turn is 90°`).toBeLessThan(0.5);
      expect(Math.abs(after!.elevation - before!.elevation), `${what}: the elevation is unchanged`).toBeLessThan(0.05);
      expect(Math.abs(after!.distance - before!.distance), `${what}: the distance is unchanged`).toBeLessThan(0.05);
      expect(Math.hypot(...after!.target.map((v, i) => v - before!.target[i])), `${what}: the target is unchanged`).toBeLessThan(0.05);
      return after!;
    }

    // a straight view: Home, then Iso
    await app.getByTestId('view-home').click();
    await settle(app, 900);
    await turnRight('from Home');
    await app.getByTestId('view-iso').click();
    await settle(app, 900);
    await turnRight('from Iso');

    // after a finger orbit: the camera was moved by hand, and a turn levels it again
    const empty = await canvasPoint(app, 0.2, 0.32);
    await touchDrag(app, empty, { x: empty.x + 90, y: empty.y + 40 });
    await settle(app, 700);
    await turnRight('after an orbit');
    // after a two-finger pan
    const at = await canvasPoint(app, 0.5, 0.32);
    await touchPan(app, at, { x: at.x + 50, y: at.y + 20 });
    await settle(app, 700);
    const afterPan = await turnRight('after a pan');

    // four turns from the last pose come back to it
    const start = afterPan;
    for (let i = 0; i < 4; i++) {
      await app.getByTestId('view-turn-right').click();
      await settle(app, 500);
    }
    await tapCamera(app);
    const back = await cameraRig(app);
    expect(back, 'the rig after four turns').toBeTruthy();
    expect(Math.hypot(...back!.position.map((v, i) => v - start.position[i])), 'four turns return to the start').toBeLessThan(0.5);
    expect(Math.hypot(...back!.target.map((v, i) => v - start.target[i])), 'and to the same target').toBeLessThan(0.05);
    expect(back!.up[2], 'and to a level horizon').toBeGreaterThan(0.999);
  });

  test('a guided slice keeps the flow into the Preview, and the plater is drawn after it (AC-1, AC-7, AC-8)', async ({ app }) => {
    test.skip(!HAS_MOCK_HOST, 'the flow slice sends to the mock print host – run it with `npm run e2e:docker`');
    let created: TestPrinter[] = [];
    try {
      created = [await addPrinter(app, { name: 'T-101 host', presetName: E2E_PRINTER })];
      await app.evaluate(async () => {
        const s = window.webslicer.getState();
        await s.refreshPresetLists();
        await s.refreshPhysicalPrinters();
      });
      clearUploads();

      await armGuidedStart(app);
      await importFile(app, CUBE);
      await settle(app, 1200);
      for (let i = 0; i < 3; i++) {
        await app.getByTestId('guided-next').click();
        await settle(app, 500);
      }
      await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');

      await app.getByTestId('slice-button').click();
      await app.waitForFunction(
        () => {
          const j = window.webslicer.getState().job;
          return !!j && ['done', 'error'].includes(j.status);
        },
        null,
        { timeout: 600_000 },
      );
      expect(await read(app, (s) => s.job?.status), 'the guided slice finished').toBe('done');
      await expect(app.getByTestId('phone-result')).toBeVisible({ timeout: 30_000 });

      // AC-7: the step-4 sheet survives the switch to the Preview – result, Send, Back and Finish
      await settle(app, 1500);
      await app.evaluate(() => window.webslicer.getState().setSheetState('peek'));
      await settle(app, 600);
      await expect(app.getByTestId('guided-preview-nav')).toBeVisible();
      await expect(app.getByTestId('send-button')).toBeVisible();
      await expect(app.getByTestId('guided-preview-back')).toBeInViewport();
      await expect(app.getByTestId('guided-preview-finish')).toBeInViewport();
      expect(await read(app, (s) => s.flowStep), 'the flow is still at step 4 in the Preview').toBe(4);
      await checkFooter(app, 'the Preview footer with the flow open', [
        'preview-info-toggle',
        'send-button',
        'guided-preview-back',
        'guided-preview-finish',
      ]);

      // AC-8: at peek the scene keeps at least 55 % of the viewport height, hidden at least 70 %
      const peek = await freeBand(app);
      const freeOf = (b: Awaited<ReturnType<typeof freeBand>>) => (b.bottom - b.top) / b.viewportHeight;
      expect(freeOf(peek), `peek leaves ${Math.round(freeOf(peek) * 100)} % of the viewport to the scene`).toBeGreaterThanOrEqual(0.55);
      const grip = await centreOf(app, '[data-testid="sheet-handle"]');
      await touchDrag(app, grip, { x: grip.x, y: grip.y + 320 }, 10);
      await settle(app, 700);
      await expect(app.getByTestId('sheet-handle')).toHaveAttribute('data-sheet-state', 'hidden');
      const hidden = await freeBand(app);
      expect(freeOf(hidden), `hidden leaves ${Math.round(freeOf(hidden) * 100)} %`).toBeGreaterThanOrEqual(0.7);
      await app.getByTestId('sheet-handle').click();
      await settle(app, 600);

      // Send reaches the mock host
      await app.getByTestId('send-button').click();
      await expect(app.getByTestId('modal')).toBeVisible();
      await app.getByTestId('modal-primary').click();
      await expect(app.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
      expect(uploads(), 'the flow sent the job').toHaveLength(1);

      // Back returns to the Plater at step 4 with the result kept, and the plater is drawn again
      await app.getByTestId('guided-preview-back').click();
      await settle(app, 1200);
      await expect(app.getByTestId('guided-step')).toHaveText('4 / 4');
      expect(await read(app, (s) => s.job?.status), 'the sliced result is kept').toBe('done');
      await tapCamera(app);
      await expectSceneDrawn(app, 'the plater after the slice');

      // Finish leaves to the free Preview layout without a question
      await app.evaluate(() => window.webslicer.getState().setView('preview'));
      await settle(app, 1000);
      await app.getByTestId('guided-preview-finish').click();
      await settle(app, 600);
      expect(await read(app, (s) => s.flowStep), 'Finish left the flow').toBeUndefined();
      await expect(app.getByTestId('guided-preview-nav')).toHaveCount(0);
      await expect(app.getByTestId('guided-card')).toHaveCount(0);
      await expect(app.getByTestId('send-button')).toBeVisible();
    } finally {
      if (created.length) await removePrinters(app, created);
      clearUploads();
    }
  });
});
