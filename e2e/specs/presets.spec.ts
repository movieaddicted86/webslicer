/**
 * Presets: renaming a user preset from its row, and the import dialog.
 *
 * The rename test drives the real controls (a saved preset, the pencil in the preset row, the dialog,
 * the list afterwards) and reads the result from the store, so a broken button or a list that does not
 * follow the new name fails it. It takes the `server-state` lock because presets are server state that
 * every other test sees.
 */
import { settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { closeDialog, dialogKind } from '../helpers/dom';
import { rest } from '../helpers/mock-host';

test.describe.configure({ lock: 'server-state' });

/**
 * Every user preset this spec can leave behind – the names it writes, plus the rename target. They
 * are cleaned up after *each* test, not only where the test got to delete them itself: a failure in
 * the middle used to leave them on the server, where the other specs of the shard see them (presets
 * are server state, and the lock only orders the tests). An explicit list on purpose – the other
 * specs, `api-smoke` and `send`, also create `E2E ` presets, and a prefix sweep would delete theirs
 * when two files of a shard run side by side.
 */
const CREATED = ['E2E rename source', 'E2E renamed print', 'E2E clash existing', 'E2E clash source'];

/** Write a user print preset through the API, the way the save dialog would. */
async function createPreset(app: Parameters<typeof settle>[0], name: string): Promise<void> {
  const res = await rest(app, 'PUT', `/api/presets/print/${encodeURIComponent(name)}`, { config: { layer_height: '0.2' } });
  expect(res.status, `creating "${name}"`).toBe(200);
  await app.evaluate(() => window.webslicer.getState().refreshPresetLists());
  await app.waitForTimeout(400);
}

test.afterEach(async ({ app }) => {
  for (const name of CREATED) await removePreset(app, name);
});

/** Delete a user print preset; a 404 (already gone) is fine – this is cleanup, not a check. */
async function removePreset(app: Parameters<typeof settle>[0], name: string): Promise<void> {
  await rest(app, 'DELETE', `/api/presets/print/${encodeURIComponent(name)}`);
}

/** Type into the dialog's name field the way React sees it (the native setter + an input event). */
async function typeName(app: Parameters<typeof settle>[0], value: string): Promise<void> {
  await app.evaluate((v) => {
    const input = document.querySelector('.modal-body input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await app.waitForTimeout(300);
}

test('a user preset is renamed from its row and the list follows', async ({ app }) => {
  const from = 'E2E rename source';
  const to = 'E2E renamed print';
  await createPreset(app, from);
  // the row shows the selected preset, so select it first – the pencil acts on that one
  await app.evaluate((n) => window.webslicer.getState().selectPreset('print', n), from);
  await app.waitForTimeout(800);

  await app.locator('.sidebar .preset-row button[aria-label="Rename user preset"]').first().click();
  await app.waitForSelector('.modal', { state: 'visible' });
  expect(await dialogKind(app)).toBe('renamePreset');
  const dialog = await app.evaluate(() => ({
    title: document.querySelector('.modal-head h2')?.textContent,
    value: (document.querySelector('.modal-body input') as HTMLInputElement | null)?.value,
  }));
  expect(dialog.title).toBe('Rename print preset');
  expect(dialog.value).toBe(from);

  await typeName(app, to);
  await app.locator('.modal-actions button.primary').click();
  await app.waitForSelector('.modal', { state: 'hidden', timeout: 15_000 });
  await settle(app, 1000);

  const after = await app.evaluate(() => {
    const s = window.webslicer.getState();
    return { slot: s.presets.print.name, names: s.presetLists.print.map((p) => p.name), dialog: s.dialog };
  });
  expect(after.slot).toBe(to);
  expect(after.names).toContain(to);
  expect(after.names).not.toContain(from);
  expect(after.dialog).toBeUndefined();

  // the preset really is on the server under the new name
  expect((await rest(app, 'GET', `/api/presets/print/${encodeURIComponent(to)}`)).status).toBe(200);
  expect((await rest(app, 'GET', `/api/presets/print/${encodeURIComponent(from)}`)).status).toBe(404);
});

test('a name that already exists is refused in the dialog, before anything is sent', async ({ app }) => {
  await createPreset(app, 'E2E clash existing');
  await createPreset(app, 'E2E clash source');
  await app.evaluate(() => window.webslicer.getState().openDialog('renamePreset', { type: 'print', name: 'E2E clash source' }));
  await app.waitForSelector('.modal', { state: 'visible' });
  await typeName(app, 'E2E clash existing');
  const state = await app.evaluate(() => ({
    error: document.querySelector('.modal-body .error')?.textContent?.trim(),
    disabled: (document.querySelector('.modal-actions button.primary') as HTMLButtonElement | null)?.disabled,
  }));
  expect(state.error).toMatch(/a user preset with this name exists/i);
  expect(state.disabled).toBe(true);
  await closeDialog(app, 'escape');
  // the refused rename changed nothing
  expect((await rest(app, 'GET', '/api/presets/print/E2E%20clash%20source')).status).toBe(200);
});

test('the import dialog offers a bundle and a G-code file, and Import waits for a file', async ({ app }) => {
  await app.evaluate(() => window.webslicer.getState().openDialog('importPresets'));
  await app.waitForSelector('.modal', { state: 'visible' });
  const dialog = await app.evaluate(() => ({
    title: document.querySelector('.modal-head h2')?.textContent,
    files: Array.from(document.querySelectorAll('.preset-import input[type="file"]')).map((i) => (i as HTMLInputElement).accept),
  }));
  expect(dialog.title).toBe('Import presets');
  expect(dialog.files).toHaveLength(2);
  expect(dialog.files[0]).toMatch(/\.ini/);
  expect(dialog.files[1]).toMatch(/gcode/);
  // no preview is shown before a file was read, so there is nothing to import
  expect(await app.locator('.modal-actions').count()).toBe(0);
  await closeDialog(app, 'escape');
});
