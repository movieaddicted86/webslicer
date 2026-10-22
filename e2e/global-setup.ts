/**
 * Checks the app under test before a spec runs: the server answers, the frontend is built, and the
 * **fixture data** is in place (the MK3S printer preset installed, no leftover jobs). A run against a
 * developer's own stack would otherwise compare against whatever printer and jobs happen to be there –
 * the failure mode would be a confusing assertion in the middle of a spec.
 */
import type { FullConfig } from '@playwright/test';

/** The printer preset every spec starts from – installed by `e2e/fixtures/data`. */
export const E2E_PRINTER = 'Original Prusa i3 MK3S & MK3S+';

async function health(baseURL: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(5000) });
    return res.ok ? undefined : `HTTP ${res.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = (config.projects[0]?.use.baseURL as string | undefined) || 'http://localhost:8080';

  // the first start reads the vendor bundles and builds the option schema – give it time
  for (let i = 0; i < 60; i++) {
    if (!(await health(baseURL))) break;
    if (i === 59) throw new Error(`${baseURL}/api/health does not answer – start the app (npm run e2e:docker) first`);
    await new Promise((r) => setTimeout(r, 2000));
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
