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
import { CUBE, read, settle } from '../helpers/app';
import { cameraPose, frameProbe, project as projectPoints, screenPoint, tapCamera, toolpathBox } from '../helpers/canvas';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { E2E_PRINTER } from '../global-setup';
import { addPrinter, clearUploads, HAS_MOCK_HOST, removePrinters, uploads, type TestPrinter } from '../helpers/mock-host';
import { canvasPoint, centreOf, touchDoubleTap, touchDrag, touchLongPress, touchPinch } from '../helpers/touch';
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

/** The centre of the first object (on its surface, where a finger hits it). */
async function objectCentre(page: Page): Promise<[number, number, number]> {
  return read(page, (s) => {
    const o = s.objects[0];
    const i = o.instances[0];
    return [i.position[0], i.position[1], i.position[2] + o.size[2] / 2] as [number, number, number];
  });
}

test.describe('the companion flow on a small screen (T-091)', () => {
  // the send test creates a print host: server state like the send spec's own tests
  test.describe.configure({ lock: 'server-state' });

  test('Library → sheet → filament → slice → preview works without scrolling the page', async ({ app }) => {
    // the phone starts on the plater with the Slice footer in reach
    await expectNoSidewaysScroll(app, 'the plater');

    // the Library is the tab the flow starts from: upload a sample, then open it
    await app.getByTestId('rail-library').click();
    await expect(app.getByTestId('modal')).toBeVisible();
    await expectInsideViewport(app, '[data-testid="modal"]', 'the Library dialog');
    await expectNoSidewaysScroll(app, 'the Library');
    await app.locator('.library input[type="file"]').setInputFiles(CUBE);
    const row = app.locator('[data-testid="library-row"]').filter({ hasText: 'calibration_cube_20mm' }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    // the row's own tap loads the file (a plain click in the open mode) and closes the dialog
    await row.locator('.name').click();
    await expect(app.getByTestId('modal')).toHaveCount(0, { timeout: 60_000 });
    await app.waitForFunction(
      () => {
        const s = window.webslicer.getState();
        return s.objects.length > 0 && s.objects.every((o) => o.modelId || o.uploadError);
      },
      null,
      { timeout: 120_000 },
    );
    await app.waitForTimeout(1000);

    // the sheet's handle is the phone's own chrome; both starting positions keep the Slice button on
    // screen, which is the one control the companion flow cannot do without
    if (isPhone()) {
      const handle = app.getByTestId('sheet-handle');
      await expect(handle).toBeVisible();
      // it starts folded to peek: the model keeps the scene and the Slice button sits in the footer
      await expect(handle).toHaveAttribute('data-sheet-state', 'peek');
      await expectInsideViewport(app, '[data-testid="slice-button"]', 'the Slice button (peek)');
      // a tap on the handle walks the positions: peek → half → full → peek, and the Slice button
      // stays on screen in every one of them
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
    await tapCamera(app);
    const home = await frameProbe(app);
    expect(home.objects, 'the cube is projected before the gesture').not.toBeNull();
    const centre = await canvasPoint(app, 0.5, 0.3);

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

  test('every view button frames the toolpaths, and the layer slider moves by touch', async ({ app, browser }) => {
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

    for (const view of ['iso', 'top', 'front'] as const) {
      await app.getByTestId(`viewer-view-${view}`).click();
      await settle(app, 900);
      // the toolpaths' centre sits at the centre of the picture (that is the orbit target, and what
      // "frames the toolpaths" means), and their box fills it – a fallback to the whole bed would
      // centre the plate and leave the print small
      const [onScreen] = (await projectPoints(app, [middle])) ?? [null];
      expect(onScreen, `${view} keeps the toolpaths in view`).not.toBeNull();
      expect(Math.abs(onScreen![0]), `${view} centres the toolpaths horizontally`).toBeLessThan(0.2);
      expect(Math.abs(onScreen![1]), `${view} centres the toolpaths vertically`).toBeLessThan(0.2);
      const projected = (await projectPoints(app, corners)) ?? [];
      const xs = projected.filter((p): p is [number, number] => !!p).map((p) => p[0]);
      const ys = projected.filter((p): p is [number, number] => !!p).map((p) => p[1]);
      expect(
        Math.max(...xs) - Math.min(...xs) > 0.5 || Math.max(...ys) - Math.min(...ys) > 0.5,
        `${view} fills the picture with the toolpaths`,
      ).toBe(true);
    }
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
