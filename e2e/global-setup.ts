/**
 * Checks the app under test **before anything is written**: the server answers, the frontend is built,
 * and the **fixture data** is in place (the fixture marker preset, the MK3S printer preset, no
 * leftover jobs). A run against a developer's own stack would otherwise compare against whatever
 * printer and jobs happen to be there – and, worse, delete the jobs and write presets into real data.
 * The suite therefore refuses a target without the positive fixture marker, and no default target
 * exists: `npm run e2e` needs `E2E_BASE_URL` (set by `npm run e2e:docker` and by CI).
 */
import type { FullConfig } from '@playwright/test';

/** The printer preset every spec starts from – installed by `e2e/fixtures/data`. */
export const E2E_PRINTER = 'Original Prusa i3 MK3S & MK3S+';

/**
 * A user **SLA print** preset that only `e2e/fixtures/data/presets/sla_print/` carries. Its presence
 * says "this data dir is a fixture copy", which no real instance has – a test against real data would
 * delete the user's jobs and overwrite their presets, so the check comes before the first write.
 *
 * SLA on purpose: a user *print* preset would take part in the compatibility pick that runs on
 * startup (`ensureCompatiblePresets`), and the first compatible one becomes the active print settings.
 * The FFF UI never reads SLA presets, so this marker is inert.
 */
export const E2E_MARKER_PRESET = 'E2E fixture – do not use';
/** The preset type the marker lives in. */
export const E2E_MARKER_TYPE = 'sla_print';

async function health(baseURL: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? undefined : `HTTP ${res.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL as string | undefined;
  if (!baseURL) {
    throw new Error(
      'no target: set E2E_BASE_URL, or use `npm run e2e:docker`, which starts the app with the fixture data and sets it. ' +
        'The suite deletes jobs and writes presets, so there is no default instance it would run against.',
    );
  }

  // the first start reads the vendor bundles and builds the option schema – give it time
  for (let i = 0; i < 60; i++) {
    if (!(await health(baseURL))) break;
    if (i === 59) throw new Error(`${baseURL}/api/health does not answer – start the app (npm run e2e:docker) first`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  // ---- the safety gate, before the first write ------------------------------------------------
  // A real instance (a compose stack, a NAS install) has jobs, presets and printers of its own; the
  // suite would delete its jobs below and overwrite presets and autosave files in the specs. The
  // marker preset is only in the fixture dir, so its absence means "stop here, write nothing".
  const marker = await fetch(`${baseURL}/api/presets/${E2E_MARKER_TYPE}/${encodeURIComponent(E2E_MARKER_PRESET)}`);
  if (!marker.ok) {
    throw new Error(
      `refusing to run: ${baseURL} is not a fixture instance – the marker preset "${E2E_MARKER_PRESET}" is missing (${marker.status}).\n` +
        'The suite deletes jobs and writes presets/printers/library files, so it must only run against a copy of ' +
        'e2e/fixtures/data. Use `npm run e2e:docker`, which starts exactly that and sets E2E_BASE_URL for you.',
    );
  }

  const installed = (await (await fetch(`${baseURL}/api/installed-printers`)).json()) as Array<{
    vendorId: string;
    modelId: string;
    variant: string;
  }>;
  if (!installed.some((p) => p.vendorId === 'PrusaResearch' && p.modelId === 'MK3S')) {
    throw new Error(
      `the fixture printer is not installed (got ${JSON.stringify(installed)}); start the app with e2e/fixtures/data as DATA_DIR – ` +
        '`npm run e2e:docker` does that',
    );
  }

  const printer = await fetch(`${baseURL}/api/presets/printer/${encodeURIComponent(E2E_PRINTER)}`);
  if (!printer.ok) throw new Error(`the fixture preset "${E2E_PRINTER}" is missing (${printer.status}); PrusaSlicer resources not loaded?`);

  const page = await fetch(`${baseURL}/`);
  const html = await page.text();
  if (!page.ok || !html.includes('<div id="root"')) throw new Error(`${baseURL}/ does not serve the built frontend (WEB_DIST missing?)`);

  // jobs of an earlier run would sit in the job list the specs read
  const jobs = (await (await fetch(`${baseURL}/api/jobs`)).json()) as Array<{ id: string }>;
  for (const j of jobs) await fetch(`${baseURL}/api/jobs/${j.id}`, { method: 'DELETE' });
}
