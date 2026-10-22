/**
 * The sidebar in the plater view – ported from `.claude/t18-browser.mjs` (S1–S9, S13).
 *
 * Everything is driven through the DOM (fields, clicks, selects) and read back from the store, so a
 * broken control is caught: the transform fields, the instance list, the object row and its add-volume
 * menu, the volume panel, height ranges, the paint panel, the quick settings, Simple/Advanced mode and
 * the extruder palette. The DOM outlines t18 captured are kept as a failure `diagnostic`.
 */
import { BRIDGE, CUBE, importFile, press, read, settle, state, waitUploads } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click, fill, manipulationRow, outline } from '../helpers/dom';
import { canvasBox, plater } from '../helpers/plater';

/** The first instance of the first object, rounded like the rest of the suite. */
const instance = (app: Parameters<typeof settle>[0]) =>
  read(app, (s) => {
    const r = (v: number) => Number(v.toFixed(6));
    const i = s.objects[0].instances[0];
    return { rotation: i.rotation.map(r), scale: i.scale.map(r), position: i.position.map(r) };
  });

test.describe('sidebar: the plater view with one object', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);
  });

  test('the sidebar shows one object row, one manipulation panel and the slice panel', async ({ app }) => {
    expect(await app.locator('.object-row').count()).toBe(1);
    expect(await app.locator('.manip').count()).toBe(1);
    expect(await app.locator('.slice-panel').count()).toBe(1);
  });

  test('the manipulation panel has the four XYZ rows with three inputs each', async ({ app }) => {
    const rows = await app.evaluate(() =>
      Array.from(document.querySelectorAll('.manip .manip-row')).map((r) => ({
        label: r.querySelector(':scope > span')?.textContent ?? '',
        inputs: r.querySelectorAll('input').length,
      })),
    );
    // head, Position, Rotation, Scale, Size – the first row is the axis header and has no input
    expect(rows.slice(0, 5).map((r) => r.inputs)).toEqual([0, 3, 3, 3, 3]);
    expect(rows.slice(1, 5).map((r) => r.label)).toEqual(['Position', 'Rotation °', 'Scale %', 'Size mm']);
  });

  test('the transform fields apply while typing, and an emptied field keeps the value', async ({ app }) => {
    const rotation = manipulationRow(app, 'Rotation °').locator('input');
    await rotation.nth(0).fill('45');
    await app.waitForTimeout(500);
    expect((await instance(app)).rotation[0]).toBeCloseTo(Math.PI / 4, 6);
    await rotation.nth(1).fill('30');
    await app.waitForTimeout(500);
    expect((await instance(app)).rotation[1]).toBeCloseTo(Math.PI / 6, 6);

    // a controlled field shows the store value again: emptying it writes nothing and re-formats
    await rotation.nth(2).fill('');
    await app.waitForTimeout(500);
    expect((await instance(app)).rotation[2]).toBe(0);
    expect(await rotation.nth(2).inputValue()).toBe('0');
  });

  test('Scale % and Size mm drive the instance, and the mirror keeps magnitudes in the panel', async ({ app }) => {
    const before = await state(app);
    const size = before.objects[0].size;

    await manipulationRow(app, 'Scale %').locator('input').nth(0).fill('150');
    await app.waitForTimeout(500);
    expect((await instance(app)).scale.every((v) => Math.abs(v - 1.5) < 1e-6)).toBe(true);

    await manipulationRow(app, 'Size mm').locator('input').nth(0).fill('30');
    await app.waitForTimeout(500);
    expect(Math.abs((await instance(app)).scale[0] * size[0] - 30)).toBeLessThan(1e-4);

    // Mirror X hides the sign in the panel but flips it in the store; a second click restores it
    await click(app, '.manip-actions.mirror button:text-is("Mirror X")', 700);
    const mirrored = await instance(app);
    expect(mirrored.scale[0]).toBeLessThan(0);
    const fields = await manipulationRow(app, 'Size mm')
      .locator('input')
      .evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.value));
    expect(fields.every((f) => !f.startsWith('-'))).toBe(true);

    await click(app, '.manip-actions.mirror button:text-is("Mirror X")', 700);
    expect((await instance(app)).scale[0]).toBeGreaterThan(0);

    await click(app, '.manip-actions button:text-is("Reset rotation")', 700);
    await click(app, '.manip-actions button:text-is("Reset scale")', 700);
    const reset = await instance(app);
    expect(reset.rotation.every((v) => v === 0)).toBe(true);
    expect(reset.scale.every((v) => v === 1)).toBe(true);
  });

  test('the Instances field adds copies, rejects an out-of-range count and the ×n badge lists them', async ({ app }) => {
    const field = manipulationRow(app, 'Instances').locator('input');
    const attrs = await field.evaluate((el: HTMLInputElement) => ({ type: el.type, min: el.min, max: el.max, step: el.step }));
    expect(attrs).toEqual({ type: 'number', min: '1', max: '1000', step: '1' });

    await field.fill('3');
    await settle(app, 900);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(3);
    await expect(app.locator('.object-row .badge.inst')).toHaveText('×3');

    // AC-2.1: an out-of-range count is rejected; the field keeps the typed text until it is left
    await field.fill('1001');
    await app.waitForTimeout(400);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(3);
    await app.locator('.slice-panel').click({ position: { x: 5, y: 5 } });
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.objects[0].instances.length)).toBe(3);
    expect(await field.inputValue()).toBe('3');

    await click(app, '.object-row .badge.inst', 700);
    expect(await app.locator('.instance-list .instance-row').count()).toBe(3);

    // rotating the second copy turns only that copy
    await click(app, '.instance-list .instance-row:nth-child(2)', 600);
    await manipulationRow(app, 'Rotation °').locator('input').nth(2).fill('30');
    await app.waitForTimeout(600);
    const rotations = await read(app, (s) => ({
      selected: s.objects[0].instances[1].id === s.selectedInstanceId,
      second: Number(s.objects[0].instances[1].rotation[2].toFixed(6)),
      first: Number(s.objects[0].instances[0].rotation[2].toFixed(6)),
    }));
    expect(rotations.selected).toBe(true);
    expect(rotations.second).toBeCloseTo(Math.PI / 6, 6);
    expect(rotations.first).toBe(0);
  });

  test('the visibility checkbox toggles the printable flag', async ({ app }) => {
    const box = app.locator('.object-row input[type=checkbox]').first();
    await expect(box).toHaveAttribute('title', 'Visible / printable');
    await box.click();
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.objects[0].visible)).toBe(false);
    await box.click();
    await app.waitForTimeout(500);
    expect(await read(app, (s) => s.objects[0].visible)).toBe(true);
  });
});

test.describe('sidebar: volumes and height ranges (UAT-10, UAT-11)', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);
  });

  test('the "+" menu adds a Modifier box, the volume panel edits it and deletes it', async ({ app }) => {
    await click(app, '.object-row .icon.add', 700);
    const menu = await app.evaluate(() => ({
      rows: Array.from(document.querySelectorAll('.add-volume-row')).map((r) =>
        Array.from(r.querySelectorAll('button')).map((b) => b.textContent),
      ),
      title: document.querySelector('.add-volume-title')?.textContent,
    }));
    expect(menu.rows).toHaveLength(5);
    expect(menu.rows[0].join()).toBe('box,cylinder,sphere,slab,file…');
    expect(menu.title).toContain('Add to');

    await click(app, '.add-volume-row:has-text("Modifier") button:text-is("box")', 800);
    await waitUploads(app);
    await settle(app, 1200);
    const volume = await read(app, (s) => {
      const v = s.objects[0].volumes[0];
      return v ? { count: s.objects[0].volumes.length, name: v.name, type: v.type } : null;
    });
    expect(volume).toEqual({ count: 1, name: 'Modifier box', type: 'ParameterModifier' });
    expect(await app.locator('.volume-row').count()).toBe(1);

    await click(app, '.volume-row', 700);
    const panel = await app.evaluate(() => ({
      types: Array.from(document.querySelectorAll('.manip.volume .manip-row.extruder select option')).map((o) => o.textContent),
      selected: window.webslicer.getState().selectedVolumeId === window.webslicer.getState().objects[0].volumes[0].id,
      settings: document.querySelector('.manip.volume button.full')?.textContent ?? null,
    }));
    expect(panel.types.join()).toBe('Part,Modifier,Support enforcer,Support blocker,Negative volume');
    expect(panel.selected).toBe(true);

    // a negative volume has no settings of its own, so the settings button disappears
    await app.locator('.manip.volume .manip-row.extruder select').first().selectOption('NegativeVolume');
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.objects[0].volumes[0].type)).toBe('NegativeVolume');
    expect(await app.locator('.manip.volume button.full').count()).toBe(0);

    await click(app, '.manip.volume button:text-is("Delete volume")', 800);
    expect(await read(app, (s) => s.objects[0].volumes.length)).toBe(0);
    expect(await app.locator('.volume-row').count()).toBe(0);

    // and it can be added again
    await click(app, '.object-row .icon.add', 600);
    await click(app, '.add-volume-row:has-text("Modifier") button:text-is("box")', 800);
    await waitUploads(app);
    await settle(app, 1200);
    expect(await read(app, (s) => s.objects[0].volumes.length)).toBe(1);
  });

  test('"+ Range" adds a range row whose three fields edit minZ, maxZ and the layer height', async ({ app }) => {
    await click(app, '.object-row', 400);
    await click(app, '.range-panel .section-head button', 800);
    const range = await read(app, (s) => {
      const r = s.objects[0].ranges[0];
      return r ? { count: s.objects[0].ranges.length, minZ: r.minZ, maxZ: r.maxZ, layerHeight: r.config.layer_height ?? null } : null;
    });
    expect(range?.count).toBe(1);

    const inputs = app.locator('.range-row input');
    expect(await inputs.count()).toBe(3);
    expect(await inputs.nth(2).getAttribute('placeholder')).toBe('–');
    await inputs.nth(0).fill('1');
    await inputs.nth(1).fill('6');
    await inputs.nth(2).fill('0.1');
    await app.waitForTimeout(600);
    expect(await read(app, (s) => s.objects[0].ranges[0])).toMatchObject({ minZ: 1, maxZ: 6, config: { layer_height: '0.1' } });
    expect(await app.locator('.range-row.invalid').count()).toBe(0);
  });
});

test.describe('sidebar: the paint panel (UAT-09)', () => {
  test('the paint button opens the panel, the tool radios and brush slider drive the state, Done leaves it', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
    });
    await settle(app, 700);

    await click(app, '.paint-panel button:has-text("Supports")', 800);
    expect(await read(app, (s) => s.paintMode)).toBe('supports');
    expect(await app.locator('.paint-tools .tool').count()).toBe(3);
    expect(await app.locator('.paint-panel .manip-actions button').first().isDisabled()).toBe(true);

    await click(app, '.paint-tools .tool.blocker input', 600);
    await fill(app, '.paint-panel .brush input[type=range]', '4.5', 600);
    const tools = await read(app, (s) => ({ tool: s.paintTool, brush: s.brushRadius }));
    expect(tools).toEqual({ tool: 'blocker', brush: 4.5 });
    await expect(app.locator('.brush span')).toHaveText(/Brush 4\.5 mm/);

    await click(app, '.paint-panel .section-head button', 800);
    expect(await read(app, (s) => s.paintMode ?? null)).toBeNull();
  });

  test('a paint stroke marks triangles of the support enforcer', async ({ app }) => {
    // the bridge's underside needs supports, and the stroke is the only way to mark them by hand
    await importFile(app, BRIDGE);
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
      s.setOption('print', 'support_material', '1');
      s.setOption('print', 'support_material_auto', '0');
      s.setOption('print', 'support_material_enforce_layers', '0');
    });
    await settle(app, 700);
    await press(app, 'l');
    await app.waitForTimeout(1800);
    expect(await read(app, (s) => s.paintMode)).toBe('supports');

    // a short stroke over the middle of the model; the triangle mask is what changes
    const box = await canvasBox(app);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await app.mouse.move(cx, cy - 30);
    await app.mouse.down();
    await app.mouse.move(cx + 25, cy - 10, { steps: 6 });
    await app.mouse.up();
    await app.waitForTimeout(1800);

    const stroke = await read(app, (s) => {
      const o = s.objects[0];
      const arr = o.paint?.supports;
      return {
        painted: arr ? Array.from(arr).filter(Boolean).length : 0,
        kinds: o.paint ? Object.keys(o.paint).sort() : [],
        version: o.paintVersion ?? 0,
        triangles: o.triangles,
      };
    });
    expect(stroke.painted, 'the stroke marked triangles').toBeGreaterThan(0);
    expect(stroke.painted).toBeLessThanOrEqual(stroke.triangles);
    expect(stroke.kinds).toContain('supports');
    expect(stroke.version).toBeGreaterThan(0);

    await press(app, 'Escape');
    await app.waitForTimeout(700);
    expect(await read(app, (s) => s.paintMode ?? null)).toBeNull();
  });
});

test.describe('sidebar: quick settings and the mode switch', () => {
  test('the quick settings write the print preset and can be switched back', async ({ app }) => {
    await importFile(app, CUBE);
    await app.locator('.quick-settings select').first().selectOption('enforcers');
    await app.waitForTimeout(900);
    const enforcers = await read(app, (s) => ({
      support: s.presets.print.current.support_material,
      auto: s.presets.print.current.support_material_auto,
      buildplate: s.presets.print.current.support_material_buildplate_only,
    }));
    expect(enforcers).toEqual({ support: '1', auto: '0', buildplate: '0' });

    await app.locator('.quick-settings select').nth(1).selectOption('40%');
    await app.waitForTimeout(900);
    expect(await read(app, (s) => s.presets.print.current.fill_density)).toBe('40%');
    expect(await app.locator('.quick-settings select').count()).toBe(3);

    // the brim checkbox toggles, so start from "off" whatever the preset carries
    const brim = app.locator('.quick-settings label.checkbox input');
    if (await brim.isChecked()) await brim.click();
    await app.waitForTimeout(600);
    await brim.click();
    await app.waitForTimeout(700);
    const brimState = await read(app, (s) => ({
      type: s.presets.print.current.brim_type,
      width: Number(s.presets.print.current.brim_width),
    }));
    expect(brimState.type).toBe('outer_only');
    expect(brimState.width).toBeGreaterThan(0);
    await expect(brim).toBeChecked();

    await brim.click();
    await app.locator('.quick-settings select').first().selectOption('none');
    await app.locator('.quick-settings select').nth(1).selectOption('15%');
    await settle(app, 900);
    const back = await read(app, (s) => ({
      support: s.presets.print.current.support_material,
      fill: s.presets.print.current.fill_density,
    }));
    expect(back).toEqual({ support: '0', fill: '15%' });
    await expect(app.locator('.quick-settings button.link')).toHaveText('All print settings…');
  });

  test('Simple mode hides the object list and the manipulation panel, Advanced brings them back', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().setMode('simple'));
    await settle(app, 900);
    const simple = await app.evaluate(() => ({
      classicList: document.querySelectorAll('.object-list').length,
      manip: document.querySelectorAll('.manip').length,
      quick: document.querySelectorAll('.quick-settings').length,
      tools: document.querySelectorAll('section.objects.simple .tools button').length,
    }));
    expect(simple).toEqual({ classicList: 0, manip: 0, quick: 1, tools: 5 });

    await app.evaluate(() => window.webslicer.getState().setMode('advanced'));
    await settle(app, 900);
    const advanced = await app.evaluate(() => ({
      mode: window.webslicer.getState().mode,
      rows: document.querySelectorAll('.object-row').length,
      tools: document.querySelectorAll('.objects .section-head .tools button').length,
    }));
    expect(advanced).toEqual({ mode: 'advanced', rows: 1, tools: 12 });
  });

  test('every toolbar action shows its own 18 px SVG icon, grouped, without overflow at 320 px (T-036)', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([window.webslicer.getState().objects[0].id]));
    await settle(app, 700);

    const toolbar = await app.evaluate(() => {
      const tools = document.querySelector('.objects .section-head .tools') as HTMLElement;
      return {
        buttons: Array.from(tools.querySelectorAll('button')).map((b) => ({
          label: b.getAttribute('aria-label'),
          title: b.getAttribute('title'),
          // no leftover Unicode glyphs: the button shows an SVG only
          text: (b.textContent ?? '').trim(),
          icon: b.querySelector('svg')?.getAttribute('width'),
          stroke: b.querySelector('svg')?.querySelectorAll('path,line,circle,rect,polyline').length,
          size: Math.round(b.getBoundingClientRect().height),
        })),
        separators: tools.querySelectorAll('.tool-sep').length,
        // the SVG path data of an icon, to prove that no two actions share a picture
        paths: Array.from(tools.querySelectorAll('button svg')).map((s) =>
          Array.from(s.querySelectorAll('path,line,circle,rect,polyline'))
            .map((n) => n.getAttribute('d') ?? n.getAttribute('points') ?? n.getAttribute('x'))
            .join('|'),
        ),
      };
    });
    expect(toolbar.buttons.map((b) => b.label)).toEqual([
      'Undo (Ctrl+Z)',
      'Redo (Ctrl+Y)',
      'Move (M)',
      'Rotate (R)',
      'Scale (S)',
      'Place on face (F): click a face in the 3D view to lay it flat on the bed',
      'Arrange (A)',
      'Add instance (+)',
      'Remove the last instance (−)',
      'Duplicate',
      'Delete the picked instance, otherwise the selected object or volume (Del)',
      'Delete all',
    ]);
    // the tooltip stays the shortcut line and is also the accessible name
    expect(toolbar.buttons.every((b) => b.title === b.label)).toBe(true);
    expect(toolbar.buttons.every((b) => b.text === '')).toBe(true);
    expect(toolbar.buttons.map((b) => b.icon)).toEqual(Array(12).fill('18'));
    expect(toolbar.buttons.every((b) => (b.stroke ?? 0) > 0)).toBe(true);
    // the hit area is at least 30 px high
    expect(toolbar.buttons.every((b) => b.size >= 30)).toBe(true);
    // four groups: history | transform tools | arrange/instances | duplicate/delete
    expect(toolbar.separators).toBe(3);
    expect(new Set(toolbar.paths).size).toBe(12);

    // AC-2: the narrowest sidebar width wraps the toolbar instead of shrinking it
    const narrow = await app.evaluate(() => {
      const sidebar = document.querySelector('.sidebar') as HTMLElement;
      sidebar.style.width = '320px';
      const tools = document.querySelector('.objects .section-head .tools') as HTMLElement;
      const buttons = Array.from(tools.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().width));
      return {
        overflow: sidebar.scrollWidth - sidebar.clientWidth,
        toolsOverflow: tools.scrollWidth - tools.clientWidth,
        widths: buttons,
        lines: new Set(Array.from(tools.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top))).size,
      };
    });
    expect(narrow.overflow).toBeLessThanOrEqual(0);
    expect(narrow.toolsOverflow).toBeLessThanOrEqual(0);
    // the icons keep their size; the toolbar uses a second line
    expect(narrow.widths.every((w) => w >= 30)).toBe(true);
    expect(narrow.lines).toBeGreaterThan(1);
    await app.evaluate(() => ((document.querySelector('.sidebar') as HTMLElement).style.width = ''));

    // the same icons in Simple mode
    await app.evaluate(() => window.webslicer.getState().setMode('simple'));
    await settle(app, 700);
    const simple = await app.evaluate(() =>
      Array.from(document.querySelectorAll('section.objects.simple .tools button svg')).map((s) => s.getAttribute('width')),
    );
    expect(simple).toEqual(Array(5).fill('18'));
    await app.evaluate(() => window.webslicer.getState().setMode('advanced'));
  });
});

test.describe('sidebar: the extruder palette (F-21)', () => {
  test('a six-nozzle printer offers the extruder paint tool with the palette colours', async ({ app }) => {
    await importFile(app, CUBE);
    await app.evaluate(() => window.webslicer.getState().select([window.webslicer.getState().objects[0].id]));
    await app.evaluate(() => window.webslicer.getState().setOption('printer', 'nozzle_diameter', '0.4,0.4,0.4,0.4,0.4,0.4'));
    await app.waitForTimeout(1800);
    expect(await read(app, (s) => s.extruderCount())).toBe(6);
    expect(await app.locator('.paint-panel button').count()).toBe(3);

    await click(app, '.paint-panel button:has-text("Extruder")', 900);
    const palette = await app.evaluate(() => ({
      swatches: Array.from(document.querySelectorAll('.paint-tools .tool.extruder .swatch')).map(
        (s) => getComputedStyle(s).backgroundColor,
      ),
      labels: Array.from(document.querySelectorAll('.paint-tools .tool.extruder')).map((t) => t.textContent?.trim()),
    }));
    expect(palette.swatches).toHaveLength(6);
    expect(palette.swatches[0]).toBe('rgb(230, 184, 74)');
    expect(palette.swatches[5]).toBe('rgb(169, 169, 245)');

    await click(app, '.paint-panel .section-head button', 800);
    await app.evaluate(() => window.webslicer.getState().setOption('printer', 'nozzle_diameter', '0.4'));
    await settle(app, 900);
    expect(await read(app, (s) => s.extruderCount())).toBe(1);
    expect(await app.locator('.paint-tools .tool.extruder .swatch').count()).toBe(0);
  });
});

test.describe('sidebar: the DOM outline stays a diagnostic', () => {
  test('a failed sidebar assertion can print the outline it compared', async ({ app }) => {
    await importFile(app, CUBE);
    const lines = await outline(app, '.sidebar');
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.some((l) => l.includes('.slice-panel'))).toBe(true);
    // the outline normalises dates, so a saved session cannot change it between two runs
    expect(lines.every((l) => !/\d{4}-\d{2}-\d{2}T[\d:.]+Z/.test(l))).toBe(true);
    // the plater reader and the outline describe the same sidebar
    expect((await plater(app)).objects).toHaveLength(1);
    await press(app, 'Escape');
  });
});

test.describe('sidebar: the plate checks before slicing (T-034)', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    // a 20 mm cube: start from the preset's own skirt/brim settings
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.select([s.objects[0].id]);
      s.updateInstance(s.objects[0].id, s.objects[0].instances[0].id, { position: [125, 105, 0] });
    });
    await settle(app, 700);
  });

  test('an object at the edge with a skirt disables Slice with the reason, back inside it is enabled', async ({ app }) => {
    // skirts on, so a cube next to the bed edge prints its skirt over the border
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setOption('print', 'skirts', '1');
      s.setOption('print', 'skirt_distance', '5');
      s.setOption('print', 'brim_type', 'none');
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[0].id, { position: [10, 105, 0] });
    });
    await settle(app, 800);

    const button = app.locator('.slice-panel button.primary.big');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /skirt .* outside the print volume/);
    await expect(app.locator('.plate-issues li')).toHaveCount(1);
    await expect(app.locator('.object-row')).not.toHaveClass(/outside/, { timeout: 2000 });

    // back to the middle: the skirt fits and Slice is enabled again
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[0].id, { position: [125, 105, 0] });
    });
    await settle(app, 800);
    await expect(button).toBeEnabled();
    await expect(app.locator('.plate-issues li')).toHaveCount(0);
  });

  test('two overlapping objects block the slice and mark both rows', async ({ app }) => {
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setOption('print', 'skirts', '0');
      s.setOption('print', 'brim_type', 'none');
      const o = s.objects[0];
      s.addInstances(o.id, 1);
    });
    await settle(app, 1200);
    // the copy is arranged next to the original, then pushed onto it
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      const o = s.objects[0];
      s.updateInstance(o.id, o.instances[1].id, { position: [o.instances[0].position[0] + 5, o.instances[0].position[1], 0] });
    });
    await settle(app, 800);

    const button = app.locator('.slice-panel button.primary.big');
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute('title', /G-code path conflict/);
    // nothing is off the bed, so no row is red – the issue list carries the reason
    await expect(app.locator('.object-row.outside')).toHaveCount(0);
    await expect(app.locator('.plate-issues li')).toHaveCount(1);
  });
});
