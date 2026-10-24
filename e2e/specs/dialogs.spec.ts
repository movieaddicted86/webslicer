/**
 * The dialogs and the settings fields – ported from `.claude/t18-browser.mjs` (S6, S11, S12).
 *
 * Three groups: the per-object / per-volume / per-range override dialogs, every dialog of the app
 * (printers, send, save preset, About, library, unsaved changes) and the settings
 * views, which are the only place every `OptionField` variant shows: number, text, checkbox, select,
 * vector, bed editor and the multiline G-code box with its commit-on-blur behaviour.
 */
import { CUBE, importFile, read, settle } from '../helpers/app';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { click, closeDialog, dialogKind, fill, openDialog } from '../helpers/dom';
import { plater } from '../helpers/plater';
import type { Page } from '@playwright/test';

/** Open a settings view and search for one option key. */
async function findSetting(app: Page, view: string, key: string): Promise<void> {
  await app.evaluate((v) => window.webslicer.getState().setView(v), view);
  await app.waitForTimeout(500);
  await fill(app, '.settings-side input.search', key, 700);
}

const objectConfig = (app: Page) => read(app, (s) => s.objects[0].config);

/* T-057: one slice for the whole file – the send dialog below only *reads* the cube job. */
let sharedJob = '';

test.beforeAll(async ({ browser }) => {
  sharedJob = await sliceOnce(browser);
});

test.describe('dialogs: the per-object, per-volume and per-range settings (S6)', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);
  });

  test('the per-object dialog adds an override, commits on Enter, resets and removes it', async ({ app }) => {
    const name = (await plater(app)).objects[0].name;
    await click(app, '.manip .manip-row.extruder button.full', 800);
    const opened = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      search: (document.querySelector('.object-settings-list input') as HTMLInputElement | null)?.placeholder,
      candidates: document.querySelectorAll('.object-settings-list li').length,
      empty: document.querySelector('.object-settings-values .muted')?.textContent?.trim(),
    }));
    expect(opened.title).toBe(`Per-object settings – ${name}`);
    expect(opened.candidates).toBeGreaterThan(10);
    expect(opened.empty).toContain('No overrides');

    await fill(app, '.object-settings-list input', 'layer_height', 600);
    const labels = await app.evaluate(() =>
      Array.from(document.querySelectorAll('.object-settings-list li span:first-child')).map((s) => s.textContent),
    );
    const idx = labels.indexOf('Layer height');
    expect(idx, 'Layer height is offered').toBeGreaterThanOrEqual(0);
    await app.locator('.object-settings-list li').nth(idx).click();
    await app.waitForTimeout(600);

    const row = await app.evaluate(() => {
      const opt = document.querySelector('#opt-layer_height');
      const input = opt?.querySelector('.control input') as HTMLInputElement | null;
      // the remove button sits next to the field in the override row, not inside it
      return {
        found: !!opt,
        type: input?.type,
        reset: opt?.querySelectorAll('.icon.reset').length ?? 0,
        remove: opt?.closest('.override-row')?.querySelector('button.icon:not(.reset)')?.getAttribute('title'),
      };
    });
    expect(row).toEqual({ found: true, type: 'number', reset: 0, remove: 'Remove override' });

    // the shared field keeps a draft: typing writes nothing, Enter commits
    const initial = (await objectConfig(app)).layer_height ?? null;
    const typed = initial === '0.35' ? '0.25' : '0.35';
    await fill(app, '#opt-layer_height input', typed, 500);
    expect((await objectConfig(app)).layer_height ?? null).toBe(initial);
    await app.locator('#opt-layer_height input').press('Enter');
    await app.waitForTimeout(500);
    expect((await objectConfig(app)).layer_height).toBe(typed);
    expect(await app.locator('#opt-layer_height .icon.reset').count()).toBe(1);

    await click(app, '#opt-layer_height .icon.reset', 600);
    expect((await objectConfig(app)).layer_height ?? null).toBe(initial);
    expect(await app.locator('#opt-layer_height .icon.reset').count()).toBe(0);

    await click(app, '.override-row > button.icon:not(.reset)', 600);
    expect(Object.keys(await objectConfig(app))).toEqual([]);
    await closeDialog(app, 'escape');
    expect(await dialogKind(app)).toBeUndefined();
  });

  test('a modifier offers only the per-volume settings, and the backdrop closes it', async ({ app }) => {
    await click(app, '[data-testid="object-add-volume"]', 700);
    await click(app, '.add-volume-row:has-text("Modifier") button:text-is("box")', 900);
    await app.waitForTimeout(2000);
    await click(app, '.volume-row', 700);
    await click(app, '.manip.volume .manip-row.extruder button.full', 800);

    await fill(app, '.object-settings-list input', 'layer', 700);
    const modifier = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      empty: document.querySelector('.object-settings-values .muted')?.textContent?.trim(),
      labels: Array.from(document.querySelectorAll('.object-settings-list li span:first-child')).map((s) => s.textContent),
    }));
    expect(modifier.title).toMatch(/^Modifier settings – Modifier box/);
    expect(modifier.labels).not.toContain('Layer height');
    expect(modifier.labels).not.toContain('First layer height');
    expect(modifier.empty).toContain('this volume');

    await closeDialog(app, 'backdrop');
    expect(await dialogKind(app)).toBeUndefined();
  });

  test('a range row opens its own dialog, which ✕ and Escape close', async ({ app }) => {
    await click(app, '[data-testid="range-add"]', 800);
    const inputs = app.locator('.range-row input');
    await inputs.nth(0).fill('1');
    await inputs.nth(1).fill('6');
    await app.waitForTimeout(600);

    const name = (await plater(app)).objects[0].name;
    await click(app, '.range-row button.icon[title="Settings for this range"]', 800);
    expect(await app.locator('[data-testid="modal-title"]').textContent()).toBe(`Height range 1–6 mm – ${name}`);
    await closeDialog(app, 'x');
    expect(await dialogKind(app)).toBeUndefined();

    await click(app, '.range-row button.icon[title="Settings for this range"]', 800);
    expect(await dialogKind(app)).toBe('objectSettings');
    await closeDialog(app, 'escape');
    expect(await dialogKind(app)).toBeUndefined();
  });
});

test.describe('dialogs: the app dialogs (S11)', () => {
  test('the Printers dialog lists vendors, families and models, and its custom tab starts a two-step wizard', async ({ app }) => {
    await openDialog(app, 'printers', { tab: 'vendor' });
    const printers = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      filter: (document.querySelector('.vendor-list input') as HTMLInputElement | null)?.placeholder,
      vendors: document.querySelectorAll('.vendor-list li').length,
      activeVendor: document.querySelector('.vendor-list li.active')?.textContent,
      families: Array.from(document.querySelectorAll('.model-list h3')).map((h) => h.textContent),
      models: document.querySelectorAll('.model-list .model').length,
      actions: Array.from(document.querySelectorAll('.add-printer [data-testid="modal-actions"] button')).map((b) => b.textContent),
      tabs: Array.from(document.querySelectorAll('.subtabs button')).map((b) => b.textContent),
    }));
    expect(printers.title).toBe('Printers');
    expect(printers.filter).toBe('Filter models…');
    expect(printers.vendors).toBeGreaterThan(1);
    expect(printers.activeVendor).toBeTruthy();
    expect(printers.families.length).toBeGreaterThan(0);
    expect(printers.models).toBeGreaterThan(1);
    expect(printers.actions).toEqual(['Apply']);
    expect(printers.tabs).toEqual(['My printers', 'Vendor profiles', 'Filaments', 'Custom printer']);

    await click(app, '.subtabs button:has-text("Custom printer")', 600);
    const custom = await app.evaluate(() => ({
      // the label text before the control only – a select's options are part of its textContent
      labels: Array.from(document.querySelectorAll('.custom-printer label')).map((l) => l.firstChild?.textContent?.trim()),
      flavors: Array.from(document.querySelectorAll('.custom-printer select option')).map((o) => (o as HTMLOptionElement).value),
      action: document.querySelector('.custom-printer [data-testid="modal-actions"] button')?.textContent,
      disabled: (document.querySelector('.custom-printer [data-testid="modal-actions"] button') as HTMLButtonElement | null)?.disabled,
      name: (document.querySelector('.custom-printer #custom-printer-name') as HTMLInputElement | null)?.value,
      step: document.querySelector('.custom-printer [data-testid="modal-actions"] .muted')?.textContent,
    }));
    expect(custom.labels).toEqual([
      'Name',
      'Bed size X (mm)',
      'Bed size Y (mm)',
      'Max print height (mm)',
      'Nozzle diameter (mm)',
      'Firmware flavor',
    ]);
    expect(custom.flavors).toHaveLength(11);
    expect(custom.action).toBe('Next');
    expect(custom.step).toContain('Step 1 of 2');
    // the form starts on a default name; an empty name cannot go on to the filament step
    expect(custom.name).toBe('My Printer');
    expect(custom.disabled).toBe(false);
    await fill(app, '.custom-printer #custom-printer-name', '', 500);
    expect(await app.locator('.custom-printer [data-testid="modal-actions"] button').isDisabled()).toBe(true);
    await closeDialog(app, 'escape');
  });

  // T-057: these two read and write the server's printer list – the other files' host tests share the
  // same lock, so two workers never see each other's hosts
  test('the physical printer form offers the three host types and starts with Save disabled', { lock: 'server-state' }, async ({ app }) => {
    // the fixture data configures no host, so the dialog opens straight on the form of a new one
    await openDialog(app, 'printers', { tab: 'hosts' });
    const form = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      // the label text before the control only – a select's options are part of its textContent
      labels: Array.from(document.querySelectorAll('.form label')).map((l) => l.firstChild?.textContent?.trim()),
      hostTypes: Array.from(document.querySelectorAll('.form select')).map((s) =>
        Array.from((s as HTMLSelectElement).options).map((o) => o.value),
      ),
      placeholders: Array.from(document.querySelectorAll('.form input')).map((i) => i.getAttribute('placeholder')),
      actions: Array.from(document.querySelectorAll('[data-testid="modal-actions"] button')).map(
        (b) => `${b.textContent}${(b as HTMLButtonElement).disabled ? ' (disabled)' : ''}`,
      ),
      limitLegend: document.querySelector('.form fieldset legend')?.textContent,
    }));
    expect(form.title).toBe('Printers');
    // S1-d: the safety limits of the machine are part of the form
    expect(form.labels).toEqual(['Name', 'Host type', 'Hostname / IP', 'API key', 'Printer preset', 'Max hotend °C', 'Max bed °C']);
    expect(form.limitLegend).toBe('Safety limits');
    expect(form.hostTypes[0]).toEqual(['prusalink', 'octoprint', 'moonraker']);
    // the host field names an example; the form may only be saved with a name and a host
    expect(form.placeholders[1]).toBe('192.168.1.50 or http://printer.local');
    expect(form.actions).toEqual(['Cancel', 'Test connection (disabled)', 'Save (disabled)']);
    await closeDialog(app, 'escape');
  });

  test(
    'the PTFE preset fills the hotend limit and the limits travel with the saved host (S1-d)',
    { lock: 'server-state' },
    async ({ app }) => {
      await openDialog(app, 'printers', { tab: 'hosts' });
      await app.getByRole('button', { name: 'PTFE hotend (max 240 °C)' }).click();
      await app.locator('.form input').nth(0).fill('PTFE host');
      await app.locator('.form input').nth(1).fill('10.0.0.9');
      const hotend = app.locator('fieldset.safety-limits input').first();
      await expect(hotend).toHaveValue('240');
      await app.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(app.locator('.printer-list')).toContainText('PTFE host');
      const saved = await app.evaluate(async () => {
        const res = await fetch('/api/printers');
        return (await res.json()) as Array<{ id: string; name: string; safety?: { maxHotend?: number } }>;
      });
      const host = saved.find((p) => p.name === 'PTFE host');
      expect(host?.safety).toEqual({ maxHotend: 240 });
      // the fixture data seeds no host; leave it that way for the other specs
      await app.evaluate(async (id) => {
        await fetch(`/api/printers/${id}`, { method: 'DELETE' });
      }, host?.id);
      await closeDialog(app, 'escape');
    },
  );

  // T-057: the dialog lists the server's hosts; another worker's host must not enable the upload
  test('the send dialog names the sliced file and the ✕ closes it', { lock: 'server-state' }, async ({ app }) => {
    await openSharedSlice(app, sharedJob);
    const job = await read(app, (s) => ({ id: s.job?.id, outputName: s.job?.outputName }));

    await openDialog(app, 'sendToPrinter');
    const send = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      labels: Array.from(document.querySelectorAll('.form label')).map((l) => l.textContent?.trim().split('\n')[0].trim()),
      filename: (document.querySelector('.form input') as HTMLInputElement | null)?.value,
      actions: Array.from(document.querySelectorAll('[data-testid="modal-actions"] button')).map((b) => b.textContent),
      slicedFor: document.querySelector('.form .muted')?.textContent,
    }));
    expect(send.title).toBe('Send G-code to printer');
    expect(send.filename).toBe(job.outputName);
    expect(send.slicedFor).toContain('Sliced for the printer preset');
    expect(send.actions).toEqual(['Cancel', 'Upload']);
    // no host is configured in the fixture data, so there is nothing to send to
    expect(await app.locator('[data-testid="modal-actions"] button.primary').isDisabled()).toBe(true);

    await closeDialog(app, 'x');
    expect(await dialogKind(app)).toBeUndefined();
  });

  test('the save-preset dialog suggests a copy and puts the focus in the name', async ({ app }) => {
    await openDialog(app, 'savePreset', { type: 'print', extruderIdx: 0 });
    const save = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      label: document.querySelector('.form label')?.textContent?.trim().split('\n')[0].trim(),
      name: (document.querySelector('.form input') as HTMLInputElement | null)?.value,
      focused: document.activeElement?.tagName.toLowerCase(),
      actions: Array.from(document.querySelectorAll('[data-testid="modal-actions"] button')).map((b) => b.textContent),
    }));
    expect(save.title).toBe('Save print preset');
    expect(save.name).toMatch(/- Copy$/);
    expect(save.focused).toBe('input');
    expect(save.actions).toEqual(['Cancel', 'Save']);
    await closeDialog(app, 'escape');
  });

  test('the About dialog lists the engine and the shortcut table', async ({ app }) => {
    await openDialog(app, 'about');
    const about = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      rows: Array.from(document.querySelectorAll('.kv tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent)),
      shortcuts: document.querySelectorAll('[data-testid="modal"] .modal-body p:last-child kbd').length,
      version: document.querySelector('[data-testid="modal"] .modal-body p')?.textContent,
    }));
    expect(about.title).toBe('About WebSlicer');
    expect(about.rows).toHaveLength(3);
    expect(about.rows[0][0]).toBe('Slicer engine');
    expect(about.rows[0][1]).toMatch(/^PrusaSlicer /);
    expect(about.shortcuts).toBeGreaterThan(10);

    await closeDialog(app, 'backdrop');
    expect(await dialogKind(app)).toBeUndefined();
  });

  test('the library dialog lists the folder and Escape closes it', async ({ app }) => {
    await openDialog(app, 'library', 'open');
    await app.waitForSelector('.library-list li');
    const library = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      crumbs: document.querySelector('.crumbs')?.textContent,
      entries: Array.from(document.querySelectorAll('.library-list li')).map((li) => li.textContent?.trim()),
    }));
    expect(library.title).toBe('Library – open model or project');
    // the image seeds the library with the sample models
    expect(library.entries.join(' ')).toContain('samples');
    await closeDialog(app, 'escape');
    expect(await dialogKind(app)).toBeUndefined();
  });

  test('the unsaved-changes dialog lists the changes and Cancel keeps them (UAT-08)', async ({ app }) => {
    // a value that differs from the preset's own, whatever that is – otherwise the slot is not modified
    const typed = await read(app, (s) => {
      const value = String(Number(s.presets.print.current.perimeters) + 1);
      window.webslicer.getState().setOption('print', 'perimeters', value);
      return value;
    });
    await app.waitForTimeout(700);

    // the switch goes through the preset select: its change handler asks the dialog
    const target = await app.evaluate(() => {
      const sel = document.querySelector('[data-testid="presets"] [data-testid^="preset-select-"] select') as HTMLSelectElement;
      return {
        from: sel.value,
        target: Array.from(sel.options)
          .map((o) => o.value)
          .find((v) => v !== sel.value && v !== '__add_printer__'),
      };
    });
    expect(target.target).toBeTruthy();
    await app
      .locator('[data-testid="presets"] [data-testid^="preset-select-"] select')
      .first()
      .selectOption(target.target as string);
    await app.waitForSelector('.changes tbody tr', { timeout: 20_000 });

    const unsaved = await app.evaluate(() => ({
      title: document.querySelector('[data-testid="modal-title"]')?.textContent,
      head: Array.from(document.querySelectorAll('.changes thead th')).map((th) => th.textContent),
      changes: Array.from(document.querySelectorAll('.changes tbody tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent)),
      actions: Array.from(document.querySelectorAll('[data-testid="modal-actions"] button')).map((b) => b.textContent),
    }));
    expect(unsaved.title).toBe('Unsaved Changes');
    expect(unsaved.head).toEqual(['Option', 'Old value', 'New value']);
    expect(unsaved.changes.length).toBeGreaterThan(0);
    expect(unsaved.changes.map((r) => r[0])).toContain('Perimeters');
    expect(unsaved.actions).toEqual(['Cancel', 'Discard', 'Save', 'Transfer']);

    await click(app, '[data-testid="modal-actions"] button:text-is("Cancel")', 800);
    const after = await read(app, (s) => ({
      dialog: s.dialog ?? null,
      preset: s.presets.print.name,
      perimeters: s.presets.print.current.perimeters,
      pending: !!s.pendingSwitch,
    }));
    expect(after).toEqual({ dialog: null, preset: target.from, perimeters: typed, pending: false });
    // the preset row shows the preset that is still loaded
    await expect(app.locator('[data-testid="presets"] [data-testid^="preset-select-"] select').first()).toHaveValue(target.from as string);
  });
});

test.describe('dialogs: the settings fields (S12)', () => {
  test('every OptionField variant renders its own control in Expert mode', async ({ app }) => {
    await app.evaluate(() => window.webslicer.getState().setMode('expert'));
    const variants = [
      { view: 'print', key: 'layer_height', control: 'number' },
      { view: 'print', key: 'perimeters', control: 'number' },
      { view: 'print', key: 'fill_density', control: 'text' },
      { view: 'print', key: 'support_material', control: 'checkbox' },
      { view: 'print', key: 'seam_position', control: 'select' },
      { view: 'printer', key: 'start_gcode', control: 'textarea' },
      { view: 'printer', key: 'bed_shape', control: 'bed' },
      { view: 'printer', key: 'machine_max_feedrate_x', control: 'vector' },
      { view: 'filament', key: 'filament_colour', control: 'vector' },
    ] as const;
    for (const { view, key, control } of variants) {
      await findSetting(app, view, key);
      await expect(app.locator(`#opt-${key}`), `${key} in ${view}`).toHaveCount(1);
      if (control === 'bed') {
        expect(await app.locator(`#opt-${key} .bed-editor`).count(), key).toBe(1);
        continue;
      }
      if (control === 'vector') {
        expect(await app.locator(`#opt-${key} .vector`).count(), key).toBe(1);
        continue;
      }
      const tag = await app.locator(`#opt-${key} .control > input, #opt-${key} .control > select, #opt-${key} .control > textarea`).first();
      if (control === 'select') await expect(tag).toHaveJSProperty('tagName', 'SELECT');
      else if (control === 'textarea') {
        await expect(tag).toHaveJSProperty('tagName', 'TEXTAREA');
        expect(await tag.getAttribute('rows')).toBe('8');
      } else {
        expect(await tag.getAttribute('type')).toBe(control);
      }
    }
    // the machine vector is two columns, the filament colour a single field
    await findSetting(app, 'printer', 'machine_max_feedrate_x');
    expect(await app.locator('#opt-machine_max_feedrate_x .vec-label').allInnerTexts()).toEqual(['Normal', 'Stealth']);
    await findSetting(app, 'filament', 'filament_colour');
    expect(await app.locator('#opt-filament_colour .vector').getAttribute('class')).not.toContain('multi');
  });

  test('a numeric, a percent and a vector setting commit on Enter, never while typing', async ({ app }) => {
    await findSetting(app, 'print', 'layer_height');
    const initial = await read(app, (s) => s.presets.print.current.layer_height);
    const typed = initial === '0.25' ? '0.35' : '0.25';
    await fill(app, '#opt-layer_height input', typed, 500);
    expect(await read(app, (s) => s.presets.print.current.layer_height)).toBe(initial);
    await app.locator('#opt-layer_height input').press('Enter');
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.presets.print.current.layer_height)).toBe(typed);
    expect(await app.locator('#opt-layer_height .icon.reset').count()).toBe(1);

    await fill(app, '.settings-side input.search', 'fill_density', 700);
    await fill(app, '#opt-fill_density input', '66%', 500);
    await app.locator('#opt-fill_density input').press('Enter');
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.presets.print.current.fill_density)).toBe('66%');
    expect(await app.locator('#opt-fill_density input').getAttribute('class')).toContain('short');

    await findSetting(app, 'filament', 'filament_colour');
    // the vector's element is one colour; the config stores it as an escaped string, so the field
    // shows the bare value and a typed colour becomes the new one
    const before = await read(app, (s) => s.presets.filament[0].current.filament_colour);
    const colour = before.toUpperCase() === '#00FF00' ? '#FF8000' : '#00FF00';
    await fill(app, '#opt-filament_colour input', colour, 500);
    expect(await read(app, (s) => s.presets.filament[0].current.filament_colour)).toBe(before);
    await app.locator('#opt-filament_colour input').first().press('Enter');
    await app.waitForTimeout(600);
    expect(await read(app, (s) => s.presets.filament[0].current.filament_colour)).toBe(colour);

    // and the fields are reset again, so a later spec sees the preset it expects
    await click(app, '#opt-filament_colour .icon.reset', 600);
    expect(await read(app, (s) => s.presets.filament[0].current.filament_colour)).toBe(before);
    await findSetting(app, 'print', 'fill_density');
    await click(app, '#opt-fill_density .icon.reset', 600);
    await fill(app, '.settings-side input.search', 'layer_height', 700);
    await click(app, '#opt-layer_height .icon.reset', 600);
    expect(await read(app, (s) => s.presets.print.current.layer_height)).toBe(initial);
  });

  test('the G-code textarea commits on blur, never on Enter', async ({ app }) => {
    await findSetting(app, 'printer', 'start_gcode');
    const field = app.locator('#opt-start_gcode textarea');
    expect(await field.getAttribute('rows')).toBe('8');
    expect(await field.getAttribute('spellcheck')).toBe('false');
    const before = await read(app, (s) => s.presets.printer.current.start_gcode);

    await field.click();
    await field.press('Control+Home');
    await field.pressSequentially('; T-030', { delay: 15 });
    await field.press('Enter');
    await app.waitForTimeout(300);
    expect(await read(app, (s) => s.presets.printer.current.start_gcode)).toBe(before);
    await field.press('Enter');
    await app.waitForTimeout(400);
    expect(await read(app, (s) => s.presets.printer.current.start_gcode)).toBe(before);

    // leaving the field commits – the two Enters above are the two characters `\n` the config stores
    await click(app, '.settings-side input.search', 800);
    const after = await read(app, (s) => s.presets.printer.current.start_gcode);
    expect(after.startsWith('; T-030\\n\\n')).toBe(true);
    expect(after.endsWith(before)).toBe(true);
    expect(await app.locator('#opt-start_gcode .icon.reset').count()).toBe(1);

    await click(app, '#opt-start_gcode .icon.reset', 700);
    expect(await read(app, (s) => s.presets.printer.current.start_gcode)).toBe(before);
  });
});
