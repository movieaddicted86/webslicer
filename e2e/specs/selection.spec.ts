/**
 * T-077: selecting one or several items – in the object list and in the Library.
 *
 * The object list: a plain click picks one row, Ctrl/Cmd toggles, Shift ranges from the last clicked
 * row, Ctrl+A selects all and Esc clears; the selection is the viewer's `selectedIds`, and the group
 * actions of the context panel act on all of it. The Library: a checkbox or a Ctrl/Shift click selects
 * several files, "Load all" imports them in one go, and one confirmation deletes the selection.
 *
 * Everything goes through the DOM (rows, buttons, keys); only the result is read back from the store,
 * so a broken control fails the test.
 */
import { CUBE, importFile, press, read, settle, waitUploads } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { closeDialog, openDialog } from '../helpers/dom';
import { byId } from '../helpers/hooks';
import type { Page } from '@playwright/test';

/** Three cubes on the plate, nothing selected. */
async function threeObjects(app: Page): Promise<string[]> {
  await importFile(app, CUBE);
  for (let i = 0; i < 2; i++) {
    await app.locator('input[type="file"]').first().setInputFiles(CUBE);
    await waitUploads(app);
  }
  await app.evaluate(() => window.webslicer.getState().select([]));
  await settle(app, 500);
  return read(app, (s) => s.objects.map((o) => o.id));
}

const selected = (app: Parameters<typeof read>[0]) => read(app, (s) => s.selectedIds);
const objectRow = (app: Parameters<typeof read>[0], i: number) => app.locator('[data-testid="object-row"]').nth(i);

test.describe('the object list selects with click, Ctrl, Shift and Ctrl+A', () => {
  test('a plain click picks one row, Ctrl toggles and Shift ranges from the last click', async ({ app }) => {
    const ids = await threeObjects(app);

    await objectRow(app, 0).click();
    expect(await selected(app)).toEqual([ids[0]]);

    // Ctrl adds a row, a second Ctrl takes it away again (a pause: two quick clicks are a double
    // click, which the row reads as a rename)
    await objectRow(app, 2).click({ modifiers: ['Control'] });
    expect(await selected(app)).toEqual([ids[0], ids[2]]);
    await settle(app, 600);
    await objectRow(app, 2).click({ modifiers: ['Control'] });
    expect(await selected(app)).toEqual([ids[0]]);

    // a plain click sets the anchor again; Shift then ranges from it and extends on the next Shift
    await objectRow(app, 0).click();
    await objectRow(app, 1).click({ modifiers: ['Shift'] });
    expect(await selected(app)).toEqual([ids[0], ids[1]]);
    await objectRow(app, 2).click({ modifiers: ['Shift'] });
    expect(await selected(app)).toEqual([ids[0], ids[1], ids[2]]);

    // Cmd is the Mac spelling of Ctrl: a Cmd click toggles too
    await objectRow(app, 0).click({ modifiers: ['Meta'] });
    expect(await selected(app)).toEqual([ids[1], ids[2]]);
  });

  test('Ctrl+A selects every object and Esc clears the selection', async ({ app }) => {
    const ids = await threeObjects(app);
    await press(app, 'Control+a');
    expect(await selected(app)).toEqual(ids);
    // the context panel shows the group actions of the whole selection
    await expect(byId(app, 'multi-selection')).toBeVisible();
    await press(app, 'Escape');
    expect(await selected(app)).toEqual([]);
    await expect(byId(app, 'multi-selection')).toHaveCount(0);
  });

  test('the group actions of a multi-selection act on all of it', async ({ app }) => {
    const ids = await threeObjects(app);
    await press(app, 'Control+a');

    // hide takes the whole selection off the plate, and one undo brings it back
    await byId(app, 'multi-visibility').click();
    expect(await read(app, (s) => s.objects.map((o) => o.visible))).toEqual([false, false, false]);
    await press(app, 'Control+z');
    expect(await read(app, (s) => s.objects.map((o) => o.visible))).toEqual([true, true, true]);

    // duplicate copies the whole selection and picks the copies
    await byId(app, 'multi-duplicate').click();
    await waitUploads(app);
    await settle(app, 800);
    expect(await read(app, (s) => s.objects.length)).toBe(ids.length * 2);
    expect((await selected(app)).length).toBe(ids.length);

    // Delete removes exactly the selection – the copies
    await press(app, 'Delete');
    await settle(app, 600);
    expect(await read(app, (s) => s.objects.map((o) => o.id))).toEqual(ids);
  });
});

test.describe('the Library selects several files', () => {
  /** Two plain files in the library root, so the delete test never touches the shipped samples. */
  const seeded = ['sel-a.bin', 'sel-b.bin'];

  test.beforeEach(async ({ app }) => {
    await app.evaluate(async (names) => {
      for (const name of names)
        await fetch(`/api/library/file?path=${encodeURIComponent(name)}`, { method: 'PUT', body: new TextEncoder().encode('payload') });
    }, seeded);
  });

  test.afterEach(async ({ app }) => {
    await app.evaluate(async (names) => {
      for (const name of names) await fetch(`/api/library/file?path=${encodeURIComponent(name)}`, { method: 'DELETE' });
    }, seeded);
  });

  /** The file rows of the open Library (a folder row has no checkbox). */
  const fileRows = (app: Page) => app.locator('[data-testid="library-row"]').filter({ has: app.locator('[data-testid="library-check"]') });
  /** A click on the row's name, so it never lands on the row's own Open/Delete buttons. */
  const clickName = (row: ReturnType<typeof fileRows>, mods: Array<'Control' | 'Shift'> = []) =>
    row.locator('.name').click({ modifiers: mods });

  test('a checkbox, a Ctrl click and Shift select several files, and Clear empties it', async ({ app }) => {
    await openDialog(app, 'library', 'open');
    // The samples folder grows with every new sample (T-078 added l_bracket.stl), so the count comes
    // from the listing instead of a literal; four is what the range below needs (rows 0, 1 and 3).
    const sampleFiles = await app.evaluate(async () => {
      const listing = (await (await fetch('/api/library?path=samples')).json()) as { entries: Array<{ dir?: boolean }> };
      return listing.entries.filter((e) => !e.dir).length;
    });
    expect(sampleFiles).toBeGreaterThanOrEqual(4);
    // the samples folder holds enough files for a range: open it first
    await byId(app, 'library-row').filter({ hasText: 'samples' }).first().locator('.name').click();
    await expect(fileRows(app)).toHaveCount(sampleFiles);

    await fileRows(app).nth(0).locator('[data-testid="library-check"]').check();
    await expect(byId(app, 'library-selection')).toContainText('1 selected');

    await clickName(fileRows(app).nth(1), ['Control']);
    await expect(byId(app, 'library-selection')).toContainText('2 selected');

    // Shift ranges from the row the Ctrl click landed on to the clicked one
    await clickName(fileRows(app).nth(3), ['Shift']);
    await expect(byId(app, 'library-selection')).toContainText('3 selected');

    await byId(app, 'library-selection').getByRole('button', { name: 'Clear' }).click();
    await expect(byId(app, 'library-selection')).toHaveCount(0);
    await closeDialog(app, 'escape');
  });

  test('the keyboard walks the rows, Space toggles and Enter opens the folder', async ({ app }) => {
    await openDialog(app, 'library', 'open');
    await byId(app, 'library-list').waitFor();
    await fileRows(app).nth(0).focus();
    // ArrowDown moves to the next row and takes it
    await app.keyboard.press('ArrowDown');
    await expect(fileRows(app).nth(1)).toBeFocused();
    await expect(byId(app, 'library-selection')).toContainText('1 selected');
    // Space toggles the focused row off again, and a second Space brings it back
    await app.keyboard.press(' ');
    await expect(byId(app, 'library-selection')).toHaveCount(0);
    await app.keyboard.press(' ');
    await expect(byId(app, 'library-selection')).toContainText('1 selected');
    // Enter on a folder row opens it – the file selection is dropped and the samples show
    const folder = byId(app, 'library-row').filter({ hasText: 'samples' }).first();
    await folder.focus();
    await app.keyboard.press('Enter');
    await expect(byId(app, 'library-row').filter({ hasText: 'calibration_cube_20mm.stl' })).toHaveCount(1);
    await expect(byId(app, 'library-selection')).toHaveCount(0);
    await closeDialog(app, 'escape');
  });

  test('Load all imports every selected file in one go', async ({ app }) => {
    await openDialog(app, 'library', 'open');
    // two of the shipped samples, picked with the checkbox and a Ctrl click
    await byId(app, 'library-row').filter({ hasText: 'samples' }).first().locator('.name').click();
    const cube = byId(app, 'library-row').filter({ hasText: 'calibration_cube_20mm.stl' }).first();
    const bridge = byId(app, 'library-row').filter({ hasText: 'bridge_table.stl' }).first();
    await cube.locator('[data-testid="library-check"]').check();
    await clickName(bridge, ['Control']);
    await expect(byId(app, 'library-selection')).toContainText('2 selected');

    await byId(app, 'library-load-all').click();
    await waitUploads(app);
    await settle(app, 1200);
    expect(await read(app, (s) => s.objects.length)).toBe(2);
    // the dialog closes itself like a single load does
    await expect(byId(app, 'modal')).toHaveCount(0);
  });

  test('Delete asks once for the selection and removes every selected file', async ({ app }) => {
    await openDialog(app, 'library', 'open');
    await byId(app, 'library-list').waitFor();
    // the two seeded files: a click on the name adds one after the other
    const target = fileRows(app).filter({ hasText: 'sel-' });
    await clickName(target.nth(0), ['Control']);
    await clickName(target.nth(1), ['Control']);
    await expect(byId(app, 'library-selection')).toContainText('2 selected');

    const asked: string[] = [];
    app.on('dialog', async (d) => {
      asked.push(d.message());
      await d.accept();
    });
    await byId(app, 'library-delete-selected').click();
    await expect(byId(app, 'library-selection')).toHaveCount(0, { timeout: 10_000 });
    // one confirmation for the whole selection, and it names the count
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('2 files');
    // both files are gone from the library
    const left = await app.evaluate(async (names) => {
      const r = (await (await fetch('/api/library')).json()) as { entries: Array<{ name: string }> };
      return r.entries.map((e) => e.name).filter((n) => names.includes(n));
    }, seeded);
    expect(left).toEqual([]);
    await closeDialog(app, 'escape');
  });
});
