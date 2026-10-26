/**
 * The safety questions of T-085 in the browser: the Safety step of the printer wizard, the blocking
 * limit it sets for slicing, and the one-time risk notice.
 *
 * The spec writes **server state** (a safety record, the risk notice, presets of its own), so it takes
 * the `server-state` lock and puts the fixture back at the end: the fixture printer keeps the answer
 * `e2e/fixtures/data/printer_safety.json` seeds (all-metal, 450 °C), and the risk notice stays
 * acknowledged. The **unanswered** case of AC-2 is this spec's own business – it answers for a preset
 * of its own rather than deleting the fixture printer's answer, so the unlocked specs of the shard
 * that render the same footer (`plate-gate`, `nesting`) never see a warning that is not theirs.
 */
import { CUBE, importFile, read, rest, settle, sliceAndWait } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { E2E_PRINTER, FIXTURE_SAFETY } from '../global-setup';
import { addPreset, removePreset } from '../helpers/mock-host';
import { click, dialogKind, fill, openDialog } from '../helpers/dom';

/** A preset of the spec's own, inheriting the fixture printer – the answers are written for it. */
const OWN_PRESET = 'E2E safety preset';

/** The safety record of one preset, written or deleted, and the store's copy brought up to date. */
async function setSafety(app: Parameters<typeof read>[0], preset: string, profile: Record<string, unknown> | null): Promise<void> {
  await rest(app, profile ? 'PUT' : 'DELETE', `/api/printer-safety/${encodeURIComponent(preset)}`, profile ?? undefined);
  await app.evaluate(() => window.webslicer.getState().refreshPrinterSafety());
  await app.waitForTimeout(500);
}

/** Make the spec's own preset the plater's printer, so the footer has no answer for it. */
async function ownPreset(app: Parameters<typeof read>[0]): Promise<void> {
  await addPreset(app, OWN_PRESET, E2E_PRINTER);
  await app.evaluate(async (name) => {
    const s = window.webslicer.getState();
    if (s.presets.printer.name !== name) await s.selectPreset('printer', name);
  }, OWN_PRESET);
  await setSafety(app, OWN_PRESET, null);
}

/** Put the fixture data's own answer back (all-metal, 450 °C), so no other spec sees a warning. */
async function restoreSafety(app: Parameters<typeof read>[0]): Promise<void> {
  await rest(app, 'PUT', `/api/printer-safety/${encodeURIComponent(E2E_PRINTER)}`, FIXTURE_SAFETY);
  await app.evaluate(() => window.webslicer.getState().refreshPrinterSafety());
  await app.waitForTimeout(500);
}

test.describe('safety: the printer wizard step, its limit and the risk notice', () => {
  test.beforeEach(async ({ app }) => {
    await importFile(app, CUBE);
    await settle(app, 600);
  });

  test.afterEach(async ({ app }) => {
    await restoreSafety(app);
    // the spec's own preset goes away again – deleting it drops its answer too, by design
    await app.evaluate(
      async ([own, fixture]) => {
        const s = window.webslicer.getState();
        if (s.presets.printer.name === own) await s.selectPreset('printer', fixture);
      },
      [OWN_PRESET, E2E_PRINTER] as const,
    );
    await removePreset(app, OWN_PRESET);
    // the notice is the one card that holds the first slice; the fixture keeps it acknowledged
    await rest(app, 'POST', '/api/risk-notice/ack');
  });

  test(
    'the footer link opens the Safety step, and the PTFE answer blocks a 260 °C slice (AC-1, AC-2)',
    { lock: 'server-state' },
    async ({ app }) => {
      const sliceButton = app.locator('[data-testid="slice-button"]');
      // no answer for this preset: a warning in the footer, and the slice still runs
      await ownPreset(app);
      await expect(app.locator('[data-testid="slice-panel"] .plate-issues.limits li')).toContainText('No hotend type set for this printer');
      await expect(sliceButton).toBeEnabled();

      // the link opens the printer setup at the safety question – no new menu entry
      await app.locator('[data-testid="slice-panel"] .plate-issues.limits button.link').first().click();
      await app.waitForTimeout(600);
      expect(await dialogKind(app)).toBe('printers');
      const step = await app.evaluate(() => ({
        title: document.querySelector('[data-testid="safety-step"] h3')?.textContent,
        hotend: (document.querySelector('#safety-hotend-type') as HTMLSelectElement | null)?.value,
        save: (document.querySelector('[data-testid="safety-step"] [data-testid="modal-primary"]') as HTMLButtonElement | null)?.disabled,
        skip: document.querySelector('[data-testid="safety-skip"]')?.textContent,
      }));
      expect(step.title).toContain(OWN_PRESET);
      expect(step.hotend).toBe('');
      expect(step.save).toBe(true);
      expect(step.skip).toBe('Ask me later');

      await app.locator('#safety-hotend-type').selectOption('ptfe');
      await click(app, '[data-testid="safety-step"] [data-testid="modal-primary"]', 1200);
      expect(await dialogKind(app)).toBeUndefined();

      // the answer is on the server, keyed by the preset name, and the warning is gone
      const record = await rest<Record<string, { hotendType: string; maxHotend: number }>>(app, 'GET', '/api/printer-safety');
      expect(record.json[OWN_PRESET]).toEqual({ hotendType: 'ptfe', maxHotend: 240 });
      await expect(app.locator('[data-testid="slice-panel"] .plate-issues.limits li')).toHaveCount(0);

      // 260 °C is fine for PETG but above the PTFE liner: the field reddens and the slice is blocked
      await app.evaluate(() => {
        const s = window.webslicer.getState();
        s.setMode('expert');
        s.setView('filament');
      });
      await app.waitForTimeout(500);
      await fill(app, '.settings-side input.search', 'temperature', 700);
      const field = app.locator('#opt-temperature input').first();
      await field.fill('260');
      await field.press('Enter');
      await app.waitForTimeout(700);
      await expect(app.locator('#opt-temperature')).toHaveClass(/issue-block/);
      await expect(app.locator('#opt-temperature .field-issue.block')).toContainText('limit of this printer (PTFE-lined hotend)');

      await app.evaluate(() => window.webslicer.getState().setView('plater'));
      await app.waitForTimeout(700);
      await expect(sliceButton).toBeDisabled();
      await expect(sliceButton).toHaveAttribute('title', /260 °C is above the 240 °C limit of this printer/);
      const listed = app.locator('[data-testid="slice-panel"] .plate-issues.limits li');
      // two findings on the same field: the material's soft range (warn) and the printer's own block
      await expect(listed).toHaveCount(2);
      await expect(listed.locator('.badge-limit.block')).toHaveCount(1);
      await expect(app.locator('[data-testid="slice-panel"] .plate-issues.limits')).toContainText(
        'limit of this printer (PTFE-lined hotend)',
      );

      // the same request, corrected to 215 °C, goes through and the job is done
      await app.evaluate(() => {
        const s = window.webslicer.getState();
        s.setMode('expert');
        s.setView('filament');
      });
      await app.waitForTimeout(500);
      await fill(app, '.settings-side input.search', 'temperature', 700);
      const again = app.locator('#opt-temperature input').first();
      await again.fill('215');
      await again.press('Enter');
      await app.waitForTimeout(700);
      await app.evaluate(() => window.webslicer.getState().setView('plater'));
      await app.waitForTimeout(500);
      await expect(sliceButton).toBeEnabled();
    },
  );

  test('the server refuses the same hot request on its own (AC-2)', { lock: 'server-state' }, async ({ app }) => {
    // the spec's own preset, answered PTFE: the fixture printer's answer is never touched
    await ownPreset(app);
    await setSafety(app, OWN_PRESET, { hotendType: 'ptfe' });
    // the slice route is the seam the UI cannot talk around: it answers 400 with the issue list
    const res = await app.evaluate(async () => {
      const s = window.webslicer.getState();
      const body = s.buildSliceRequest() as {
        filaments: Array<{ name?: string; config: Record<string, string> }>;
      };
      body.filaments = [
        {
          name: body.filaments[0]?.name ?? 'f',
          config: { ...body.filaments[0]?.config, filament_type: 'PETG', temperature: '260', first_layer_temperature: '260' },
        },
      ];
      const res = await fetch('/api/slice', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        json: (await res.json()) as { error?: string; issues?: Array<{ rule: string }> },
      };
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toContain('260 °C is above the 240 °C limit of this printer');
    expect(res.json.issues?.map((i) => i.rule)).toContain('config.hotend_limit');
  });

  test(
    'the custom printer asks the safety question between the printer and its filament (AC-1)',
    { lock: 'server-state' },
    async ({ app }) => {
      const name = 'E2E safety printer';
      const filamentName = `${name} – Generic`;
      await openDialog(app, 'printers', { tab: 'vendor' });
      await click(app, '.subtabs button:has-text("Custom printer")', 600);
      await fill(app, '#custom-printer-name', name, 400);
      await click(app, '.custom-printer [data-testid="modal-actions"] button:text-is("Next")', 600);

      // step 2: the answer; Save stays disabled until a type is chosen
      await expect(app.locator('.safety-step [data-testid="modal-actions"] .muted')).toContainText('Step 2 of 3 – Safety');
      await expect(app.locator('.safety-step [data-testid="modal-primary"]')).toBeDisabled();
      await app.locator('#safety-hotend-type').selectOption('all-metal');
      await app.waitForTimeout(300);
      await click(app, '.safety-step [data-testid="modal-primary"]', 600);

      // step 3 – and the answer is stored with the printer preset
      await expect(app.locator('.filament-for-printer [data-testid="modal-actions"] .muted')).toContainText('Step 3 of 3');
      await click(app, '.filament-for-printer [data-testid="modal-actions"] button:text-is("Save")', 2500);
      await expect(app.locator('[data-testid="modal"]')).toHaveCount(0);

      const record = await rest<Record<string, { hotendType: string; maxHotend: number }>>(app, 'GET', '/api/printer-safety');
      expect(record.json['E2E safety printer']).toEqual({ hotendType: 'all-metal', maxHotend: 450 });

      // "Ask me later" on a re-open stores nothing new
      await rest(app, 'DELETE', `/api/printer-safety/${encodeURIComponent('E2E safety printer')}`);
      await openDialog(app, 'printers', { tab: 'custom', safety: 'E2E safety printer' });
      await click(app, '[data-testid="safety-skip"]', 600);
      expect(await dialogKind(app)).toBeUndefined();
      expect((await rest<Record<string, unknown>>(app, 'GET', '/api/printer-safety')).json['E2E safety printer']).toBeUndefined();

      // cleanup: the presets the wizard created
      await rest(app, 'DELETE', `/api/presets/printer/${encodeURIComponent('E2E safety printer')}`);
      await rest(app, 'DELETE', `/api/presets/filament/${encodeURIComponent(filamentName)}`);
    },
  );

  test(
    'reopening the safety question shows the stored answer, and "Ask me later" keeps it (AC-1)',
    { lock: 'server-state' },
    async ({ app }) => {
      // a stored "other" answer on a preset of the spec's own: reopening pre-fills type, number, bed
      await addPreset(app, OWN_PRESET, E2E_PRINTER);
      await setSafety(app, OWN_PRESET, { hotendType: 'other', maxHotend: 300, maxBed: 100 });
      await openDialog(app, 'printers', { safety: OWN_PRESET });
      await expect(app.locator('#safety-hotend-type')).toHaveValue('other');
      await expect(app.locator('#safety-hotend-limit')).toHaveValue('300');
      await expect(app.locator('#safety-max-bed')).toHaveValue('100');

      // "Ask me later" changes nothing – the answer that is already there stays
      await click(app, '[data-testid="safety-skip"]', 600);
      expect(await dialogKind(app)).toBeUndefined();
      const record = await rest<Record<string, unknown>>(app, 'GET', '/api/printer-safety');
      expect(record.json[OWN_PRESET]).toEqual({ hotendType: 'other', maxHotend: 300, maxBed: 100 });
    },
  );

  test(
    'the risk notice is a one-time card, gated by the checkbox and stored server-side (AC-4)',
    { lock: 'server-state' },
    async ({ app }) => {
      // a fresh reload lands on the plater whatever tab an earlier test left the browser on
      const reloadToPlater = async () => {
        await app.reload();
        await app.waitForFunction(() => !!window.webslicer?.getState().ready, null, { timeout: 90_000 });
        await app.evaluate(() => {
          const s = window.webslicer.getState();
          if (s.dialog) s.closeDialog();
          s.setView('plater');
        });
        await app.waitForTimeout(1200);
      };
      // reset, then the first slice asks: the notice was never acknowledged
      await rest(app, 'DELETE', '/api/risk-notice/ack');
      await reloadToPlater();
      await importFile(app, CUBE);
      await settle(app, 600);

      await app.locator('[data-testid="slice-button"]').click();
      await app.waitForTimeout(800);
      // the card comes before the slice, with Continue locked until "I understand"
      expect(await dialogKind(app)).toBe('riskNotice');
      await expect(app.locator('[data-testid="risk-notice-card"]')).toBeVisible();
      await expect(app.locator('[data-testid="risk-notice-card"]')).toContainText('Print at your own risk');
      await expect(app.locator('[data-testid="risk-notice-continue"]')).toBeDisabled();
      // nothing reached the server while the card waits for the click
      expect(await read(app, (s) => s.job)).toBeUndefined();

      await app.locator('[data-testid="risk-notice-understood"]').check();
      await app.waitForTimeout(300);
      await expect(app.locator('[data-testid="risk-notice-continue"]')).toBeEnabled();
      await app.locator('[data-testid="risk-notice-continue"]').click();
      await app.waitForTimeout(800);

      // the acknowledgement is on the server, so another browser sees it
      const stored = await rest<{ acknowledged: boolean }>(app, 'GET', '/api/risk-notice');
      expect(stored.json.acknowledged).toBe(true);
      // …and the slice now runs to completion
      await sliceAndWait(app);
      expect((await read(app, (s) => s.job))?.status).toBe('done');

      // "Not now" keeps it away for the session without storing anything
      await rest(app, 'DELETE', '/api/risk-notice/ack');
      await reloadToPlater();
      await app.locator('[data-testid="slice-button"]').click();
      await app.waitForTimeout(800);
      expect(await dialogKind(app)).toBe('riskNotice');
      await app.locator('[data-testid="risk-notice-later"]').click();
      await app.waitForTimeout(500);
      expect(await dialogKind(app)).toBeUndefined();
      expect((await rest<{ acknowledged: boolean }>(app, 'GET', '/api/risk-notice')).json.acknowledged).toBe(false);
      // the session remembers the answer, so the next slice does not ask again
      await app.locator('[data-testid="slice-button"]').click();
      await app.waitForTimeout(800);
      expect(await dialogKind(app)).toBeUndefined();
    },
  );
});
