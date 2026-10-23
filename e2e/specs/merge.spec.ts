/**
 * T-042: merge objects, the object info and renaming.
 *
 * AC-1 merges two cubes and checks that one object with one part is left, that the parts sit where
 * the cubes sat (the object's bounding box covers both) and that the filament of the merged plate
 * stays within 1 % of the two separate cubes. AC-2 checks the info panel (20 mm cube → 8 cm³, clean
 * mesh) and renaming through the DOM (double-click, Enter, Esc) plus a 3MF round trip of the names.
 */
import { CUBE, importFile, read, settle, sliceAndWait, state, waitUploads } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

/** The object info line of the first row, read from the DOM. */
const infoText = (app: Parameters<typeof read>[0]) => app.locator('.object-row + .object-info').first().innerText();

/** Total filament (mm) of the current job. */
const filament = (app: Parameters<typeof read>[0]) => read(app, (s) => (s.job?.info?.filamentUsedMm || []).reduce((a, b) => a + b, 0));

test.describe('merge, object info and rename', () => {
  test('two cubes merge into one object whose filament is unchanged', async ({ app }) => {
    // one cube, sliced: the reference filament
    await importFile(app, CUBE);
    await sliceAndWait(app);
    const single = await filament(app);
    expect(single).toBeGreaterThan(0);

    // a second cube, then select both
    await app.locator('input[type="file"]').first().setInputFiles(CUBE);
    await waitUploads(app);
    await settle(app, 1200);
    const before = await state(app);
    expect(before.objects).toHaveLength(2);
    const ids = before.objects.map((o) => o.id);
    const positions = before.objects.map((o) => o.instances[0].position);

    await app.evaluate((sel) => window.webslicer.getState().select(sel), ids);
    await settle(app, 400);
    await expect(app.locator(`button[title^="Merge the selected objects"]`)).toBeEnabled();
    await app.locator('button[title^="Merge the selected objects"]').click();
    await waitUploads(app);
    await settle(app, 1200);

    const after = await state(app);
    expect(after.objects).toHaveLength(1);
    // the second cube became a part of the first, named after it
    expect(after.objects[0].volumes.length).toBe(1);
    expect(after.objects[0].volumes[0].type).toBe('ModelPart');
    expect(after.objects[0].volumes[0].name).toMatch(/cube/i);
    expect(after.objects[0].volumes[0].modelId, 'the merged part was uploaded').toBeTruthy();
    // the part sits where the second cube sat: the two instance positions differ by the arrangement
    const dx = positions[1][0] - positions[0][0];
    const dy = positions[1][1] - positions[0][1];
    const volume = after.objects[0].volumes[0];
    expect(Math.hypot(volume.position[0] - dx, volume.position[1] - dy)).toBeLessThan(1);

    // the plate still slices, and the filament is the same as the two separate cubes (±1 % of double)
    // `before.job` is the single-cube job: the merged slice has to be a new one
    await sliceAndWait(app, before.job?.id);
    const merged = await filament(app);
    expect(Math.abs(merged - 2 * single) / (2 * single)).toBeLessThan(0.01);
  });

  test('the object info reports 8 cm³ for the 20 mm cube and no open edges', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);

    const row = await infoText(app);
    expect(row).toMatch(/20 × 20 × 20 mm/);
    expect(row).toMatch(/8(\.0+)? cm³/);
    expect(row).toMatch(/12 triangles/);
    expect(row).toMatch(/1 instance/);
    expect(row).not.toMatch(/Not manifold/);

    // the manipulation panel shows the same figures
    const panel = await app.locator('.object-info-panel').innerText();
    expect(panel).toMatch(/8(\.0+)? cm³/);
  });

  test('rename with double-click and Enter, cancel with Esc, and the names survive a 3MF round trip', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);

    // double-click the name → inline field, Enter saves
    const name = app.locator('.object-row .name').first();
    await name.dblclick();
    const field = app.locator('.object-row input.inline-name').first();
    await expect(field).toBeVisible();
    await field.fill('Renamed cube');
    await field.press('Enter');
    await settle(app, 500);
    expect(await read(app, (s) => s.objects[0].name)).toBe('Renamed cube');
    await expect(app.locator('.object-row .name').first()).toHaveText('Renamed cube');

    // Esc cancels and keeps the old name
    await app.locator('.object-row .name').first().dblclick();
    await app.locator('.object-row input.inline-name').first().fill('Should not stick');
    await app.locator('.object-row input.inline-name').first().press('Escape');
    await settle(app, 500);
    expect(await read(app, (s) => s.objects[0].name)).toBe('Renamed cube');

    // F2 on the selected object opens the field too
    await app.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await app.keyboard.press('F2');
    await expect(app.locator('.object-row input.inline-name').first()).toBeVisible();
    await app.locator('.object-row input.inline-name').first().press('Escape');

    // rename a part as well (add one through the store, then double-click its name)
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      void s.addVolume(s.objects[0].id, {
        name: 'Part 1',
        type: 'ModelPart',
        geometry: s.objects[0].geometry.clone(),
      });
    });
    await waitUploads(app);
    await settle(app, 800);
    await app.locator('.volume-row .name').first().dblclick();
    await app.locator('.volume-row input.inline-name').first().fill('Inner part');
    await app.locator('.volume-row input.inline-name').first().press('Enter');
    await settle(app, 500);
    const volName = await read(app, (s) => s.objects[0].volumes[0].name);
    expect(volName).toBe('Inner part');

    // round trip: export the project, import it back, both names are the ones we typed
    const buf = await app.evaluate(async () => {
      const s = window.webslicer.getState();
      const req = s.buildSliceRequest();
      const res = await fetch('/api/export/3mf', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
      return Array.from(new Uint8Array(await res.arrayBuffer()));
    });
    await app.evaluate(async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'model/3mf' });
      const file = new File([blob], 'roundtrip.3mf');
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, buf);
    await waitUploads(app);
    await settle(app, 1500);
    const names = await read(app, (s) => s.objects.map((o) => ({ name: o.name, volumes: o.volumes.map((v) => v.name) })));
    expect(names.some((o) => o.name === 'Renamed cube')).toBe(true);
    expect(names.some((o) => o.volumes.includes('Inner part'))).toBe(true);
  });
});
