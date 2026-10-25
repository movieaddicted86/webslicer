/**
 * The mock print host the send tests upload to: where it listens, where its log is, and the printers
 * the spec registers for it.
 *
 * The host is a **sibling container** (`e2e/mock-host`, started by `npm run e2e:docker` and by CI), so
 * the server under test reaches it by container name and no port is published to the host. The log is
 * a file in a bind-mounted directory, which the spec reads directly – no second network path.
 *
 * Both variables are set by the runner: `E2E_MOCK_URL` is the address as the app container sees it,
 * `E2E_MOCK_DIR` the directory on *this* machine that is mounted as the mock's data dir.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { rest } from './app';

export { rest };

export const MOCK_URL = process.env.E2E_MOCK_URL || '';
export const MOCK_DIR = process.env.E2E_MOCK_DIR || '';

/** One upload the mock received, as it went into its log. */
export interface MockUpload {
  at: string;
  method: string;
  path: string;
  contentType: string;
  apiKey?: string;
  overwrite?: string;
  printAfterUpload?: string;
  filename?: string;
  fields: { select?: string; print?: string; root?: string };
  bytes: number;
}

const logFile = () => path.join(MOCK_DIR, 'uploads.log');

/** Every upload the mock recorded so far (an absent log means none). */
export function uploads(): MockUpload[] {
  try {
    return fs
      .readFileSync(logFile(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MockUpload);
  } catch {
    return [];
  }
}

/** Forget the uploads of an earlier test; the next assertion compares against an empty list. */
export function clearUploads(): void {
  fs.rmSync(logFile(), { force: true });
}

/**
 * Whether the suite runs with the mock host. Against a hand-started app (`npm run e2e`) there is no
 * container to upload to, and a send test must never reach a real printer – the spec skips instead.
 */
export const HAS_MOCK_HOST = !!MOCK_URL && !!MOCK_DIR;

/** The host field a printer needs: the mock's address without a scheme (the server adds `http://`). */
export function mockHost(): string {
  return MOCK_URL.replace(/^https?:\/\//, '');
}

/** A printer the spec registered, deleted again in its `afterAll`. */
export interface TestPrinter {
  id: string;
  name: string;
  type: string;
  presetName?: string;
  safety?: { maxHotend?: number; maxBed?: number };
}

/**
 * Create a print host through the API, as the app's printer dialog does. The body goes through the
 * page, so it shares the app's origin and the route's own validation.
 *
 * A host gets a full all-metal profile by default (T-080): the dialog asks for the hotend type, and a
 * host without a profile would otherwise carry the `send.no_limits` warning in every test. `safety:
 * null` creates the unanswered host on purpose.
 */
export async function addPrinter(
  app: Page,
  printer: {
    name: string;
    type?: 'octoprint' | 'moonraker' | 'prusalink';
    presetName?: string;
    safety?: { maxHotend?: number; maxBed?: number } | null;
  },
): Promise<TestPrinter> {
  const res = await rest<TestPrinter>(app, 'POST', '/api/printers', {
    name: printer.name,
    type: printer.type ?? 'moonraker',
    host: mockHost(),
    presetName: printer.presetName,
    safety: printer.safety === null ? undefined : (printer.safety ?? { maxHotend: 450, maxBed: 150 }),
  });
  if (res.status !== 200) throw new Error(`creating the printer "${printer.name}" failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

/** Delete every printer the suite created; the fixture data seeds none. */
export async function removePrinters(app: Page, printers: TestPrinter[]): Promise<void> {
  for (const p of printers) await rest(app, 'DELETE', `/api/printers/${p.id}`);
}

/** The current printer list from the server (the app's store is a copy). */
export async function printers(app: Page): Promise<TestPrinter[]> {
  return (await rest<TestPrinter[]>(app, 'GET', '/api/printers')).json;
}

/** Create a user printer preset that inherits `parent` (the send check reads the lineage). */
export async function addPreset(app: Page, name: string, parent: string): Promise<void> {
  const res = await rest(app, 'PUT', `/api/presets/printer/${encodeURIComponent(name)}`, { config: {}, inherits: parent });
  if (res.status !== 200) throw new Error(`creating the preset "${name}" failed: ${res.status} ${JSON.stringify(res.json)}`);
}

export async function removePreset(app: Page, name: string): Promise<void> {
  await rest(app, 'DELETE', `/api/presets/printer/${encodeURIComponent(name)}`);
}
