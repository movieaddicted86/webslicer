/**
 * The send dialog and the send gate (S1-b) – ported from `.claude/t026-browser.mjs`.
 *
 * The "printer" is the mock print host of `e2e/mock-host`, a sibling container the app under test
 * reaches by name; every upload it receives lands in a log file the spec reads. A real printer is
 * never involved, and nothing is ever started on one (`startPrint` stays off).
 *
 * The checks are the t026 list: the dialog preselects the host that matches the job's printer preset
 * (never the first one), a mismatch blocks, the block needs an override *with a reason*, a derived
 * preset only warns, an unbound host warns and asks for a second confirmation before it may start a
 * print, the upload really happens, and the server enforces the same gate on its own (409).
 */
import { read, settle, sliceAndWait } from '../helpers/app';
import { expect, openSharedSlice, sliceOnce, test } from '../helpers/fixtures';
import { E2E_PRINTER } from '../global-setup';
import { dialogSnapshot, openDialog } from '../helpers/dom';
import {
  addPreset,
  addPrinter,
  clearUploads,
  HAS_MOCK_HOST,
  removePreset,
  removePrinters,
  rest,
  uploads,
  type TestPrinter,
} from '../helpers/mock-host';
import type { Page } from '@playwright/test';

/** A printer preset the fixture MK3S job was *not* sliced for – the block case. */
const OTHER_PRESET = '- default FFF -';
/** A user preset derived from the fixture preset – the warn case. */
const DERIVED_PRESET = 'E2E Workshop MK3S';

/** The three hosts the check distinguishes, plus the exact match that has to win the preselection. */
interface Hosts {
  exact: TestPrinter;
  derived: TestPrinter;
  unbound: TestPrinter;
  mismatch: TestPrinter;
}

test.describe('send: the send gate and the upload (S1-b, T-026)', () => {
  test.skip(!HAS_MOCK_HOST, 'the send tests need the mock print host – run them with `npm run e2e:docker`');

  /*
   * T-057: the seven tests that talk about the *unedited* cube job share one slice (same cube, same
   * fixture preset) instead of slicing per test; only the two tests that change the plate before
   * slicing (a custom G-code, a higher temperature) still slice for themselves. The hosts are created
   * per test – they are server state the tests assert on.
   */
  let sharedJob = '';

  test.beforeAll(async ({ browser }) => {
    sharedJob = await sliceOnce(browser);
  });

  let created: TestPrinter[] = [];

  /*
   * T-057: the printer list and the mock's upload log are **server state** – two workers on the same
   * instance would see each other's hosts (the send dialog preselects the exact match, the printers
   * dialog lists the rows) and each other's uploads. Every test that creates a host or reads the log
   * therefore takes one lock; the tests of this file still run one after another, the other specs of
   * the shard keep running in parallel. Tests inside the file are serial anyway (`fullyParallel`
   * stays off) – the lock only orders this file against the other files of its shard.
   */
  test.describe.configure({ lock: 'server-state' });

  test.afterEach(async ({ app }) => {
    await removePrinters(app, created);
    await removePreset(app, DERIVED_PRESET);
    created = [];
    clearUploads();
  });

  /**
   * Slice the cube for the fixture printer preset and register the hosts. The creation order is the
   * *wrong* one on purpose (derived, unbound, mismatched before the exact match), so a dialog that
   * falls back to the first host is caught.
   */
  async function prepare(app: Page, which: Array<keyof Hosts> = ['exact', 'derived', 'unbound', 'mismatch']): Promise<Partial<Hosts>> {
    // the shared slice: the cube and the fixture preset of every test that does not change the plate
    await openSharedSlice(app, sharedJob);
    const job = await read(app, (s) => ({ id: s.job?.id, preset: s.job?.presets?.printer }));
    expect(job.id, 'the slice finished with a job').toBeTruthy();
    expect(job.preset).toBe(E2E_PRINTER);
    expect(job.id && (await read(app, (s) => s.job?.status))).toBe('done');

    // a user preset that inherits the fixture printer preset: the same machine, but derived
    await addPreset(app, DERIVED_PRESET, E2E_PRINTER);

    const create = async (name: string, presetName?: string) => {
      const printer = await addPrinter(app, { name, presetName });
      created.push(printer);
      return printer;
    };
    const hosts: Partial<Hosts> = {};
    if (which.includes('derived')) hosts.derived = await create('Derived host', DERIVED_PRESET);
    if (which.includes('unbound')) hosts.unbound = await create('Unbound host');
    if (which.includes('mismatch')) hosts.mismatch = await create('Other host', OTHER_PRESET);
    if (which.includes('exact')) hosts.exact = await create('MK3S host', E2E_PRINTER);

    // the app loaded before the hosts and the derived preset existed: pick both up the way the
    // dialog would (the preset list is what the send check reads the lineage from)
    await app.evaluate(async () => {
      const s = window.webslicer.getState();
      await s.refreshPresetLists();
      await s.refreshPhysicalPrinters();
    });
    await settle(app, 400);
    return hosts;
  }

  /** Open the send dialog from the store and wait for its first render (the preselect runs once). */
  async function sendDialog(app: Page) {
    await openDialog(app, 'sendToPrinter');
    await expect(app.locator('.modal .form select')).toHaveCount(1);
  }

  const uploadButton = (app: Page) => app.locator('.modal-actions button.primary');
  const checkbox = (app: Page, label: string) => app.locator(`.modal label.checkbox:has-text("${label}") input`);

  test('the dialog preselects the host set up for the job preset and blocks nothing', async ({ app }) => {
    const hosts = await prepare(app);
    await sendDialog(app);

    const dialog = await dialogSnapshot(app);
    expect(dialog.title).toBe('Send G-code to printer');
    expect(dialog.buttons).toEqual(['Cancel', 'Upload']);
    // the exact match wins even though the derived, unbound and mismatched host were created first
    await expect(app.locator('.modal .form select')).toHaveValue(hosts.exact?.id ?? '');
    await expect(app.locator('.modal .form select option:checked')).toContainText(`MK3S host (moonraker) · ${E2E_PRINTER}`);
    // no block – but the MK3S preset's own start/end G-code writes "M907 E430"/"M907 E538", so the
    // preflight of S1-c warns for both lines (one warn box with two findings)
    await expect(app.locator('.modal .warn')).toHaveCount(1);
    await expect(app.locator('.modal .warn .gcode-line')).toHaveCount(2);
    await expect(app.locator('.modal .warn')).toContainText('M907');
    await expect(app.locator('.modal label.checkbox:has-text("Send anyway")')).toHaveCount(0);
    await expect(uploadButton(app)).toBeEnabled();
    // the message names the preset the job was sliced for (`.first()`: the preflight findings below
    // use the same muted small style for their line)
    await expect(app.locator('.modal .form .muted.small').first()).toContainText(`Sliced for the printer preset ${E2E_PRINTER}`);
    // and the file name starts as the job's output name
    const job = await read(app, (s) => s.job?.outputName);
    await expect(app.locator('.modal .form input').first()).toHaveValue(job ?? '');
  });

  test('a mismatched host blocks the upload until an override with a written reason', async ({ app }) => {
    const hosts = await prepare(app, ['mismatch']);
    await sendDialog(app);

    await app.locator('.modal .form select').selectOption(hosts.mismatch?.id ?? '');
    await app.waitForTimeout(300);
    const block = await app.locator('.modal .warn').first().textContent();
    expect(block).toContain(`sliced for the printer preset "${E2E_PRINTER}"`);
    expect(block).toContain(`is set up for "${OTHER_PRESET}"`);
    // a block is not a warning: there is no second confirmation to tick, only the override. One warn
    // box for the block, one for the MK3S preset's own M907 lines (S1-c)
    await expect(uploadButton(app)).toBeDisabled();
    await expect(app.locator('.modal .warn.issue-list')).toHaveCount(2);
    await expect(app.locator('.modal .warn.issue-list').first()).toContainText('sliced for the printer preset');

    // the override alone does not help – it needs a reason the server can audit
    await checkbox(app, 'Send anyway').check();
    await app.waitForTimeout(200);
    await expect(uploadButton(app)).toBeDisabled();
    const reason = app.locator('.modal input[placeholder*="Why this G-code"]');
    await expect(reason).toBeVisible();
    await reason.fill('   ');
    await app.waitForTimeout(200);
    await expect(uploadButton(app), 'a blank reason is no reason').toBeDisabled();
    await reason.fill('same nozzle, same bed, checked by hand');
    await app.waitForTimeout(200);
    await expect(uploadButton(app)).toBeEnabled();

    // switching the host drops the override again: it belonged to that printer
    await app.locator('.modal .form select').selectOption(hosts.mismatch?.id ?? '');
    await app.waitForTimeout(200);
    await expect(uploadButton(app)).toBeDisabled();
    expect(await app.locator('.modal input[placeholder*="Why this G-code"]').count()).toBe(0);
  });

  test('a derived preset only warns; an unbound host warns and asks for a second confirmation', async ({ app }) => {
    const hosts = await prepare(app, ['derived', 'unbound']);
    await sendDialog(app);

    await app.locator('.modal .form select').selectOption(hosts.derived?.id ?? '');
    await app.waitForTimeout(300);
    const derived = await app.locator('.modal .warn').first().textContent();
    expect(derived).toContain(`set up for the printer preset "${DERIVED_PRESET}"`);
    expect(derived).toContain(`which is derived from "${E2E_PRINTER}"`);
    await expect(uploadButton(app), 'a warning does not block the upload').toBeEnabled();
    await expect(app.locator('.modal label.checkbox:has-text("Send anyway")')).toHaveCount(0);

    await app.locator('.modal .form select').selectOption(hosts.unbound?.id ?? '');
    await app.waitForTimeout(300);
    const unbound = await app.locator('.modal .warn').first().textContent();
    expect(unbound).toContain('is not linked to a printer preset');
    await expect(uploadButton(app)).toBeEnabled();

    // starting the print right away turns a warning into something the user has to confirm
    await checkbox(app, 'Start printing after upload').check();
    await app.waitForTimeout(200);
    const confirm = checkbox(app, 'I understand the warning');
    await expect(confirm).toBeVisible();
    await expect(uploadButton(app)).toBeDisabled();
    // `click`, not `check`: confirming removes the checkbox (the warning is acknowledged), so a
    // `check` would wait for a checked state that never exists
    await confirm.click();
    await app.waitForTimeout(300);
    await expect(uploadButton(app)).toBeEnabled();

    // ... and the confirmation goes away with "start printing"
    await checkbox(app, 'Start printing after upload').uncheck();
    await app.waitForTimeout(200);
    expect(await app.locator('.modal label.checkbox:has-text("I understand the warning")').count()).toBe(0);
    await expect(uploadButton(app)).toBeEnabled();
  });

  test('a matching host uploads to the mock print host and the dialog closes', async ({ app }) => {
    const hosts = await prepare(app, ['exact']);
    const job = await read(app, (s) => ({ id: s.job?.id ?? '', outputName: s.job?.outputName ?? '' }));
    clearUploads();

    // the preview's own button is the way in – it is enabled because a host exists now
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1200);
    const send = app.locator('.stats .actions button', { hasText: 'Send to printer' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(app.locator('.modal .form select')).toHaveCount(1);
    await expect(app.locator('.modal .form select')).toHaveValue(hosts.exact?.id ?? '');

    await uploadButton(app).click();
    await expect(app.locator('.modal'), 'the dialog closes after a successful upload').toHaveCount(0, { timeout: 60_000 });
    await expect(app.locator('.toast.success')).toContainText('Uploaded');

    const sent = uploads();
    expect(sent).toHaveLength(1);
    const [u] = sent;
    // Moonraker: multipart POST on /server/files/upload, the file under `root=gcodes`, no auto start
    expect(u.method).toBe('POST');
    expect(u.path).toBe('/server/files/upload');
    expect(u.filename).toBe(job.outputName);
    expect(u.fields.root).toBe('gcodes');
    expect(u.fields.print).toBe('false');
    expect(u.bytes).toBeGreaterThan(1000);
    // the G-code itself arrived, not an empty body: the mock logged the multipart size
    expect(u.contentType).toContain('multipart/form-data');
    expect(job.id).not.toBe('');
  });

  test('the server refuses a mismatched send on its own, and an override needs a reason', async ({ app }) => {
    const hosts = await prepare(app, ['mismatch']);
    clearUploads();
    const jobId = await read(app, (s) => s.job?.id ?? '');
    const body = { printerId: hosts.mismatch?.id, filename: 'direct.gcode' };

    const refused = await rest<{ error: string; issues: Array<{ rule: string; severity: string }> }>(
      app,
      'POST',
      `/api/jobs/${jobId}/send`,
      body,
    );
    expect(refused.status).toBe(409);
    expect(refused.json.error).toContain(`sliced for the printer preset "${E2E_PRINTER}"`);
    // the block first, then the preflight warnings of the MK3S preset's own M907 lines (S1-c)
    const [firstIssue, ...preflightWarnings] = refused.json.issues.map((i) => `${i.severity}:${i.rule}`);
    expect(firstIssue).toBe('block:send.preset_mismatch');
    expect(preflightWarnings).toEqual(['warn:gcode.motor_current', 'warn:gcode.motor_current']);
    expect(uploads(), 'a refused send uploads nothing').toHaveLength(0);

    const noReason = await rest<{ error: string }>(app, 'POST', `/api/jobs/${jobId}/send`, { ...body, override: true, reason: '  ' });
    expect(noReason.status).toBe(400);
    expect(noReason.json.error).toBe('an override needs a reason');
    expect(uploads()).toHaveLength(0);

    const overridden = await rest<{ ok: boolean; issues: Array<{ rule: string }> }>(app, 'POST', `/api/jobs/${jobId}/send`, {
      ...body,
      override: true,
      reason: 'same nozzle, same bed, checked by hand',
    });
    expect(overridden.status).toBe(200);
    expect(overridden.json.ok).toBe(true);
    // the accepted override still reports the issues it went past – the block and the two preflight warnings
    expect(overridden.json.issues.map((i) => i.rule)).toEqual(['send.preset_mismatch', 'gcode.motor_current', 'gcode.motor_current']);
    const sent = uploads();
    expect(sent).toHaveLength(1);
    expect(sent[0].filename).toBe('direct.gcode');

    // the unknown printer is a 400, not a crash
    expect((await rest(app, 'POST', `/api/jobs/${jobId}/send`, { printerId: 'nope' })).status).toBe(400);
  });

  test('the three host types upload through their own API', async ({ app }) => {
    await prepare(app, []);
    const jobId = await read(app, (s) => s.job?.id ?? '');
    clearUploads();

    // octoprint: multipart on /api/files/local, `select` and `print` as form fields
    const octo = await addPrinter(app, { name: 'Octo', type: 'octoprint', presetName: E2E_PRINTER });
    created.push(octo);
    const o = await rest<{ ok: boolean }>(app, 'POST', `/api/jobs/${jobId}/send`, { printerId: octo.id, filename: 'cube.gcode' });
    expect(o.status).toBe(200);
    expect(o.json.ok).toBe(true);

    // prusalink: PUT the raw bytes to /api/v1/files/usb/<encoded name>, overwrite and print as headers
    const prusa = await addPrinter(app, { name: 'Link', type: 'prusalink', presetName: E2E_PRINTER });
    created.push(prusa);
    const p = await rest<{ ok: boolean }>(app, 'POST', `/api/jobs/${jobId}/send`, {
      printerId: prusa.id,
      filename: 'my cube.gcode',
      startPrint: true,
    });
    expect(p.status).toBe(200);
    expect(p.json.ok).toBe(true);

    const [octoUp, prusaUp] = uploads();
    expect(octoUp.path).toBe('/api/files/local');
    expect(octoUp.fields).toMatchObject({ select: 'false', print: 'false' });
    expect(prusaUp.method).toBe('PUT');
    expect(prusaUp.path).toBe('/api/v1/files/usb/my%20cube.gcode');
    expect(prusaUp.overwrite).toBe('?1');
    expect(prusaUp.printAfterUpload).toBe('?1');
    expect(prusaUp.bytes).toBeGreaterThan(1000);
    expect(prusaUp.contentType).toBe('application/octet-stream');
  });

  test('a printer without a host cannot be reached and the send reports it', async ({ app }) => {
    await prepare(app, []);
    const jobId = await read(app, (s) => s.job?.id ?? '');
    // port 1 on the mock container: nothing listens, the upload fails instead of hanging or crashing
    const broken = await rest<TestPrinter>(app, 'POST', '/api/printers', { name: 'Broken', type: 'moonraker', host: 'mock-host:1' });
    created.push(broken.json);
    const res = await rest<{ ok: boolean; message: string }>(app, 'POST', `/api/jobs/${jobId}/send`, { printerId: broken.json.id });
    // a failed upload is the route's 502, with the host's answer in the body
    expect(res.status).toBe(502);
    expect(res.json.ok).toBe(false);
    expect(res.json.message).toBeTruthy();
  });

  /**
   * S1-c: a custom G-code at a layer puts a forbidden command into the real output. The preflight of
   * the finished job finds it, the preview panel states it, the send dialog lists it with its line and
   * the server refuses the send until it is overridden with a reason (which the audit log takes).
   */
  test('a forbidden command in the sliced G-code blocks the send until an override with a reason', async ({ app }) => {
    await prepare(app, ['exact']);
    // a custom G-code at 5 mm: PrusaSlicer writes "M500" into the layer between the toolpaths
    await app.evaluate(() => window.webslicer.getState().addCustomGcode({ type: 'custom', printZ: 5, extra: 'M500 ; T-031' }));
    await settle(app, 300);
    await sliceAndWait(app, await read(app, (s) => s.job?.id));
    expect(await read(app, (s) => s.job?.status)).toBe('done');

    // the job record carries the scan of the finished file: the M500 blocks, the printer preset's own
    // M907 lines (start/end G-code) only warn – the case the rule set was adjusted for
    const preflight = await read(app, (s) => s.job?.info?.preflight);
    expect(preflight?.version).toBe(1);
    const forbidden = preflight?.issues.filter((i) => i.rule === 'gcode.forbidden_command') ?? [];
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0]).toMatchObject({ severity: 'block' });
    expect(forbidden[0]?.text).toContain('M500');
    expect(forbidden[0]?.line).toBeGreaterThan(0);
    expect(preflight?.issues.filter((i) => i.rule === 'gcode.motor_current').every((i) => i.severity === 'warn')).toBe(true);

    // the preview panel states the count and lists the finding with its line
    await app.evaluate(() => window.webslicer.getState().setView('preview'));
    await settle(app, 1200);
    const panel = app.locator('.preview-panel .preflight');
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('summary')).toContainText('1 blocking');
    await expect(panel.locator('li.error').first()).toContainText('M500');
    await expect(panel.locator('li.error .gcode-line').first()).toContainText(`Line ${forbidden[0]?.line}:`);

    // the send dialog shows the same block – and it belongs to the file, not the host, so the exact
    // match is preselected and the upload is still disabled
    const hosts = { exact: created.find((p) => p.name === 'MK3S host') };
    await sendDialog(app);
    await expect(app.locator('.modal .form select')).toHaveValue(hosts.exact?.id ?? '');
    const block = await app.locator('.modal .warn').first().textContent();
    expect(block).toContain('M500');
    await expect(app.locator('.modal .warn .gcode-line').first()).toContainText(`Line ${forbidden[0]?.line}:`);
    await expect(uploadButton(app)).toBeDisabled();

    // the server refuses it with the same issue, line and text included, and uploads nothing
    const jobId = await read(app, (s) => s.job?.id ?? '');
    const exactId = hosts.exact?.id;
    clearUploads();
    const refused = await rest<{ error: string; issues: Array<{ rule: string; severity: string; line: number; text: string }> }>(
      app,
      'POST',
      `/api/jobs/${jobId}/send`,
      { printerId: exactId, filename: 'preflight.gcode' },
    );
    expect(refused.status).toBe(409);
    const issue = refused.json.issues.find((i) => i.rule === 'gcode.forbidden_command');
    expect(issue?.severity).toBe('block');
    expect(issue?.text).toContain('M500');
    expect(issue?.line).toBeGreaterThan(0);
    expect(uploads(), 'a preflight block uploads nothing').toHaveLength(0);

    // the override with a reason goes through and lands in the audit log
    const overridden = await rest<{ ok: boolean; issues: Array<{ rule: string }> }>(app, 'POST', `/api/jobs/${jobId}/send`, {
      printerId: exactId,
      filename: 'preflight.gcode',
      override: true,
      reason: 'the EEPROM save is wanted for this test',
    });
    expect(overridden.status).toBe(200);
    expect(overridden.json.ok).toBe(true);
    expect(overridden.json.issues.map((i) => i.rule)).toContain('gcode.forbidden_command');
    expect(uploads()).toHaveLength(1);
    // the dialog's own button follows the same rule: the override needs its reason there too
    await app.locator('.modal label.checkbox:has-text("Send anyway") input').check();
    await app.waitForTimeout(200);
    await expect(uploadButton(app)).toBeDisabled();
    await app.locator('.modal input[placeholder*="Why this G-code"]').fill('checked by hand');
    await app.waitForTimeout(200);
    await expect(uploadButton(app)).toBeEnabled();
    await app.locator('.modal-actions button:has-text("Cancel")').click();
  });

  test('a job hotter than the host allows is a printer-limit block with an audited override (S1-d)', async ({ app }) => {
    await prepare(app, ['exact']);
    // raise the hotend above a PTFE hotend's 240 °C: the value stays inside the global catcher
    await app.evaluate(() => {
      const s = window.webslicer.getState();
      s.setOption('filament', 'temperature', '245', 0);
      s.setOption('filament', 'first_layer_temperature', '245', 0);
    });
    await settle(app, 300);
    await sliceAndWait(app, await read(app, (s) => s.job?.id));
    expect(await read(app, (s) => s.job?.status)).toBe('done');
    expect(await read(app, (s) => s.job?.temperatures)).toEqual({ hotend: 245, bed: expect.any(Number) });

    // a second, identical host with a PTFE limit – the exact match is preselected, so the dialog is
    // opened on the limited host explicitly
    const ptfe = await addPrinter(app, { name: 'PTFE host', presetName: E2E_PRINTER, safety: { maxHotend: 240 } });
    created.push(ptfe);
    await app.evaluate(async () => window.webslicer.getState().refreshPhysicalPrinters());
    await sendDialog(app);
    await app.locator('.modal .form select').selectOption(ptfe.id);
    await settle(app, 300);
    // a block and a warn: the PTFE limit is the block, the preset's own M907 lines only warn
    await expect(app.locator('.modal .warn').first()).toContainText('limited to 240 °C');
    await expect(uploadButton(app)).toBeDisabled();

    // the server refuses with the same rule, and uploads nothing
    const jobId = await read(app, (s) => s.job?.id ?? '');
    clearUploads();
    const refused = await rest<{ error: string; issues: Array<{ rule: string; severity: string }> }>(
      app,
      'POST',
      `/api/jobs/${jobId}/send`,
      {
        printerId: ptfe.id,
        filename: 'limit.gcode',
      },
    );
    expect(refused.status).toBe(409);
    expect(refused.json.issues.map((i) => [i.rule, i.severity])).toContainEqual(['send.printer_limit', 'block']);
    expect(uploads()).toHaveLength(0);

    // the override with a reason uploads and is audited
    const overridden = await rest<{ ok: boolean; issues: Array<{ rule: string }> }>(app, 'POST', `/api/jobs/${jobId}/send`, {
      printerId: ptfe.id,
      filename: 'limit.gcode',
      override: true,
      reason: 'the hotend was replaced with an all-metal one',
    });
    expect(overridden.status).toBe(200);
    expect(overridden.json.ok).toBe(true);
    expect(overridden.json.issues.map((i) => i.rule)).toContain('send.printer_limit');
    expect(uploads()).toHaveLength(1);
  });
});

test.describe('send: the printer dialog sees the mock host', () => {
  test.skip(!HAS_MOCK_HOST, 'the send tests need the mock print host – run them with `npm run e2e:docker`');
  // T-057: the printers dialog lists every host on the server, so this group shares the lock above
  test.describe.configure({ lock: 'server-state' });

  test('the physical printers dialog lists a configured host instead of the form', async ({ app }) => {
    const created = [await addPrinter(app, { name: 'Listed host', presetName: E2E_PRINTER })];
    try {
      await app.evaluate(async () => {
        await window.webslicer.getState().refreshPhysicalPrinters();
      });
      await openDialog(app, 'physicalPrinters');
      // with a host stored the dialog opens on the list (the fixture data seeds none, so the other
      // spec sees the empty form) – the second branch of the t18 check
      const list = await app.evaluate(() => ({
        title: document.querySelector('.modal-head h2')?.textContent,
        rows: Array.from(document.querySelectorAll('.printer-list li')).map((li) => li.textContent?.trim()),
        actions: Array.from(document.querySelectorAll('.modal-actions button')).map((b) => b.textContent),
        form: document.querySelectorAll('.form').length,
      }));
      expect(list.title).toBe('Physical printers');
      expect(list.rows).toHaveLength(1);
      expect(list.rows[0]).toContain('Listed host');
      expect(list.rows[0]).toContain('moonraker');
      expect(list.actions).toEqual(['Add printer']);
      expect(list.form).toBe(0);

      // the dialog's own form is the way back in
      await app.locator('.modal-actions button:has-text("Add printer")').click();
      await expect(app.locator('.form label')).toHaveCount(7); // five fields, the two safety limits (S1-d)
      await app.locator('.modal-head button').click();
    } finally {
      await removePrinters(app, created);
    }
  });

  test('the "test connection" of a printer reaches the mock host', async ({ app }) => {
    // the fixture data seeds no host, so the dialog starts on its empty list
    const created = [await addPrinter(app, { name: 'Probe', presetName: E2E_PRINTER })];
    try {
      const res = await rest<{ ok: boolean; message: string }>(app, 'POST', `/api/printers/${created[0].id}/test`);
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      expect(res.json.message).toContain('Moonraker reachable');
      // and a host that cannot be reached answers with ok:false rather than an error
      const down = await rest<{ ok: boolean; message: string }>(app, 'POST', '/api/printers/test', {
        type: 'moonraker',
        host: 'mock-host:1',
      });
      expect(down.json.ok).toBe(false);
    } finally {
      await removePrinters(app, created);
    }
  });
});
