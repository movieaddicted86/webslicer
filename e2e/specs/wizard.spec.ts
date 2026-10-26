/**
 * The configuration wizard: the filament step that filters the filament selector, and the custom
 * printer that creates a printer preset together with its filament preset.
 *
 * The two halves write server state (the ticked filaments, two user presets), so the spec resets both
 * after itself – the other specs share the fixture instance's data. The dialog is driven through the
 * DOM: the tabs, the filter, the checkboxes and the Back/Next/Save buttons are what a user touches.
 */
import { expect, test } from '../helpers/fixtures';
import { click, closeDialog, dialogKind, fill, openDialog } from '../helpers/dom';
import { read } from '../helpers/app';

/** The values of the filament selector's options, as the sidebar shows them. */
async function filamentOptions(app: Parameters<typeof read>[0]): Promise<string[]> {
  return app.evaluate(() => {
    const select = Array.from(document.querySelectorAll('[data-testid="presets"] [data-testid^="preset-select-"]')).find(
      (p) => p.querySelector('label')?.textContent?.trim() === 'Filament',
    );
    return Array.from(select?.querySelectorAll('option') ?? []).map((o) => (o as HTMLOptionElement).value);
  });
}

/** PUT the visible filament list back (an empty list is the "show all" state). */
async function setVisible(app: Parameters<typeof read>[0], names: string[]): Promise<void> {
  await app.evaluate(async (list) => {
    await fetch('/api/presets/filaments/visible', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ names: list }),
    });
  }, names);
  await app.evaluate((list) => window.webslicer.setState({ visibleFilaments: list }), names);
}

/** Delete a user preset the spec created, so the shared fixture stays as it was found. */
async function deletePreset(app: Parameters<typeof read>[0], type: string, name: string): Promise<void> {
  await app.evaluate(
    async ([t, n]) => {
      await fetch(`/api/presets/${t}/${encodeURIComponent(n)}`, { method: 'DELETE' });
    },
    [type, name],
  );
}

test.describe('configuration wizard', () => {
  test('the filament step filters the selector, and the escape hatch shows the whole list again', async ({ app }) => {
    const before = await filamentOptions(app);
    expect(before.length).toBeGreaterThan(3);

    await openDialog(app, 'printers', { tab: 'vendor' });
    await click(app, '.subtabs button:has-text("Filaments")', 800);
    await expect(app.locator('.filament-step .vendor-list li').first()).toBeVisible();

    // narrow the catalogue, tick everything the filter left, apply
    await fill(app, '.filament-step input[aria-label="Filter filaments"]', 'Prusament PLA', 600);
    const shown = await app.evaluate(() => ({
      vendors: document.querySelectorAll('.filament-step .vendor-list li').length,
      entries: document.querySelectorAll('.filament-step .filament-entries input[type="checkbox"]').length,
      status: document.querySelector('.filament-step-head .muted')?.textContent,
    }));
    expect(shown.vendors).toBeGreaterThan(0);
    expect(shown.entries).toBeGreaterThan(0);
    expect(shown.status).toContain('Nothing selected');

    await click(app, '.filament-vendor-head button:text-is("All")', 600);
    expect(await app.locator('.filament-step-head .muted').textContent()).toContain('selected');
    await click(app, '.filament-step [data-testid="modal-actions"] button:text-is("Apply")', 1500);
    expect(await dialogKind(app)).toBeUndefined();

    const ticked = await read(app, (s) => s.visibleFilaments);
    expect(ticked.length).toBeGreaterThan(0);

    // every option the selector still offers is ticked, a default, a user preset or the active one
    const after = await filamentOptions(app);
    expect(after.length).toBeLessThan(before.length);
    const allowed = new Set(ticked);
    const presets = await read(app, (s) => s.presetLists.filament);
    const selected = await read(app, (s) => s.presets.filament[0].name);
    for (const name of after) {
      const p = presets.find((x) => x.name === name);
      const ok = !p || !p.system || name.startsWith('- default') || name === selected || allowed.has(name);
      expect(ok, `${name} is shown although it is neither ticked, a user preset, a default nor the active one`).toBe(true);
    }
    // the active filament is never hidden by the filter
    expect(after).toContain(selected);

    // the escape hatch in the sidebar restores the full list for this session
    await app.locator('[data-testid="presets"] label.checkbox:has-text("Show all filaments") input').check();
    await app.waitForTimeout(500);
    expect(await filamentOptions(app)).toEqual(before);
    await app.locator('[data-testid="presets"] label.checkbox:has-text("Show all filaments") input').uncheck();
    await app.waitForTimeout(500);

    // the tick list survives a reload – it is stored on the server, like the installed printers
    await app.reload();
    await app.waitForFunction(() => !!window.webslicer?.getState().ready, null, { timeout: 90_000 });
    await app.waitForTimeout(1500);
    expect(await read(app, (s) => s.visibleFilaments)).toEqual(ticked);
    expect((await filamentOptions(app)).length).toBe(after.length);

    await setVisible(app, []);
  });

  test('a custom printer asks for its filament in a second step and creates both presets', async ({ app }) => {
    const name = 'E2E wizard printer';
    const filamentName = `${name} – Generic`;
    await openDialog(app, 'printers', { tab: 'vendor' });
    await click(app, '.subtabs button:has-text("Custom printer")', 600);

    await fill(app, '#custom-printer-name', name, 400);
    const first = await app.evaluate(() => ({
      step: document.querySelector('.custom-printer [data-testid="modal-actions"] .muted')?.textContent,
      action: document.querySelector('.custom-printer [data-testid="modal-actions"] button')?.textContent,
    }));
    expect(first.step).toContain('Step 1 of 3');
    expect(first.action).toBe('Next');

    await click(app, '.custom-printer [data-testid="modal-actions"] button:text-is("Next")', 600);
    // T-085: the safety question sits between the printer and its filament
    const safety = await app.evaluate(() => ({
      step: document.querySelector('.safety-step [data-testid="modal-actions"] .muted')?.textContent,
      actions: Array.from(document.querySelectorAll('.safety-step [data-testid="modal-actions"] button')).map((b) => b.textContent),
      save: (document.querySelector('.safety-step [data-testid="modal-primary"]') as HTMLButtonElement | null)?.disabled,
    }));
    expect(safety.step).toContain('Step 2 of 3 – Safety');
    expect(safety.actions).toEqual(['Back', 'Ask me later', 'Save']);
    expect(safety.save).toBe(true);

    await app.locator('#safety-hotend-type').selectOption('ptfe');
    await click(app, '.safety-step [data-testid="modal-primary"]', 600);
    const second = await app.evaluate(() => {
      const value = (id: string) => (document.querySelector(id) as HTMLInputElement | null)?.value;
      return {
        step: document.querySelector('.filament-for-printer [data-testid="modal-actions"] .muted')?.textContent,
        filamentName: value('#custom-filament-name'),
        temperatures: [
          '#custom-filament-temperature',
          '#custom-filament-first_layer_temperature',
          '#custom-filament-bed_temperature',
          '#custom-filament-first_layer_bed_temperature',
          '#custom-filament-filament_diameter',
        ].map(value),
        actions: Array.from(document.querySelectorAll('.filament-for-printer [data-testid="modal-actions"] button')).map(
          (b) => b.textContent,
        ),
      };
    });
    expect(second.step).toContain('Step 3 of 3');
    expect(second.filamentName).toBe(filamentName);
    // the defaults the wizard documents: both layers alike, PLA on a heated bed, 1.75 mm
    expect(second.temperatures).toEqual(['215', '215', '60', '60', '1.75']);
    expect(second.actions).toEqual(['Back', 'Save']);

    await click(app, '.filament-for-printer [data-testid="modal-actions"] button:text-is("Save")', 2500);
    expect(await dialogKind(app)).toBeUndefined();

    // the printer and its filament are selected, and both presets are on the server
    expect(await read(app, (s) => s.presets.printer.name)).toBe(name);
    expect(await read(app, (s) => s.presets.filament[0].name)).toBe(filamentName);
    const stored = await app.evaluate(
      async ([p, f]) => {
        const printer = await (await fetch(`/api/presets/printer/${encodeURIComponent(p)}`)).json();
        const filament = await (await fetch(`/api/presets/filament/${encodeURIComponent(f)}`)).json();
        return {
          printer: { system: printer.system, nozzle: printer.config?.nozzle_diameter, bed: printer.config?.bed_shape },
          filament: {
            system: filament.system,
            temperature: filament.config?.temperature,
            firstLayer: filament.config?.first_layer_temperature,
            bed: filament.config?.bed_temperature,
            firstLayerBed: filament.config?.first_layer_bed_temperature,
            diameter: filament.config?.filament_diameter,
          },
        };
      },
      [name, filamentName],
    );
    expect(stored.printer).toEqual({ system: false, nozzle: '0.4', bed: '0x0,220x0,220x220,0x220' });
    expect(stored.filament).toEqual({
      system: false,
      temperature: '215',
      firstLayer: '215',
      bed: '60',
      firstLayerBed: '60',
      diameter: '1.75',
    });

    await deletePreset(app, 'printer', name);
    await deletePreset(app, 'filament', filamentName);
  });

  test('an absurd temperature is blocked in the form and refused by the API', async ({ app }) => {
    await openDialog(app, 'printers', { tab: 'vendor' });
    await click(app, '.subtabs button:has-text("Custom printer")', 600);
    await click(app, '.custom-printer [data-testid="modal-actions"] button:text-is("Next")', 600);
    // T-085: step 2 is the safety question – "Ask me later" stores nothing and moves on
    await click(app, '.safety-step [data-testid="safety-skip"]', 600);

    await fill(app, '#custom-filament-temperature', '2150', 600);
    const blocked = await app.evaluate(() => ({
      issue: document.querySelector('#opt-temperature .field-issue')?.textContent ?? '',
      severity: document.querySelector('#opt-temperature')?.className ?? '',
      save: (document.querySelector('.filament-for-printer [data-testid="modal-actions"] .primary') as HTMLButtonElement | null)?.disabled,
    }));
    expect(blocked.issue).toContain('temperature = 2150 °C');
    expect(blocked.severity).toContain('issue-block');
    expect(blocked.save).toBe(true);

    // the server refuses the same value on its own, without the form in the way
    const status = await app.evaluate(
      async () =>
        (
          await fetch('/api/presets/filament/Blocked%20filament', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { filament_type: 'PLA', temperature: '2150' } }),
          })
        ).status,
    );
    expect(status).toBe(400);

    // a corrected value unblocks Save
    await fill(app, '#custom-filament-temperature', '215', 600);
    expect(await app.locator('.filament-for-printer [data-testid="modal-actions"] .primary').isDisabled()).toBe(false);
    await closeDialog(app, 'escape');
  });
});
