/**
 * End-to-end test of the MCP endpoint (T-006, AC-1 … AC-5) against a running WebSlicer server.
 *
 * Usage (from the repository root, with the SDK available in node_modules):
 *
 *   MCP_TOKEN=<token> npx tsx server/scripts/mcp-e2e.ts
 *
 * Environment:
 *   MCP_URL            MCP endpoint, default http://localhost:8080/mcp
 *   MCP_TOKEN          bearer token of the run (required)
 *   MCP_TOKEN_B        second token, used for the owner isolation check (AC-3)
 *   MCP_TOKENS_FILE    token file of that server; with MCP_TOKEN_B the script adds the second token
 *                      there (that is what a user does by hand – phase 1 has no token UI)
 *   AUDIT_LOG          audit log file of that server, default ./data/audit.log (AC-4)
 *   MCP_EXPECT_DISABLED=1
 *                      the server has no token configured: check only that /mcp answers 404 (AC-1)
 *
 * The script installs the MK4S printer through `PUT /api/installed-printers` if the server does not
 * have it yet – the same step the setup wizard does. Without an installed printer `list_printers`
 * and `list_presets` have nothing to show (a fresh data directory knows no printer).
 *
 * Against the Docker container (data directory bind-mounted, e.g. `docker run -p 8081:8080 -v
 * $PWD/.claude/mcp-e2e-data:/data webslicer`):
 *
 *   MCP_URL=http://localhost:8081/mcp MCP_TOKEN=secret AUDIT_LOG=.claude/mcp-e2e-data/audit.log \
 *   MCP_TOKENS_FILE=.claude/mcp-e2e-data/mcp-tokens.json MCP_TOKEN_B=secret-b npx tsx server/scripts/mcp-e2e.ts
 */
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { hashToken } from '../src/mcp/tokens.js';
import { TOOL_NAMES } from '../src/mcp/tools.js';

const URL_MCP = process.env.MCP_URL || 'http://localhost:8080/mcp';
const API = URL_MCP.replace(/\/mcp\/?$/, '');
const TOKEN = process.env.MCP_TOKEN || '';
const TOKEN_B = process.env.MCP_TOKEN_B || '';
const TOKENS_FILE = process.env.MCP_TOKENS_FILE || '';
const AUDIT_LOG = process.env.AUDIT_LOG || 'data/audit.log';
const EXPECT_DISABLED = !!process.env.MCP_EXPECT_DISABLED;

const SAMPLES = 'samples/calibration_cube_20mm.stl';
const VENDOR = 'PrusaResearch';
const MODEL = 'MK4S';
const VARIANT = 'HF0.4';
const PRINTER = 'Original Prusa MK4S HF0.4 nozzle';
const PRINT = '0.20mm SPEED @MK4S HF0.4';
const FILAMENT = 'Prusament PLA @MK4S HF0.4';

const results: { name: string; ok: boolean }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`);
};

/** A raw POST to /mcp (for the status codes the SDK client hides). */
async function post(body: unknown, token?: string): Promise<{ status: number; text: string }> {
  const res = await fetch(URL_MCP, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

/** A connected MCP client for one token. */
async function connect(token: string): Promise<Client> {
  const client = new Client({ name: 'webslicer-e2e', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_MCP), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  );
  return client;
}

/** Call a tool and return its JSON payload, or the error text. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown> & { ok: boolean; error?: string }> {
  try {
    const res = await client.callTool({ name, arguments: args });
    const block = (res.content as Array<{ type: string; text?: string }>)[0];
    const text = block?.text ?? '';
    if (res.isError) return { ok: false, error: text };
    try {
      return { ok: true, ...(JSON.parse(text) as Record<string, unknown>) };
    } catch {
      return { ok: true, text };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface InstalledPrinter {
  vendorId: string;
  modelId: string;
  variant: string;
}

/** Install the printer model, the step the setup wizard does (`PUT /api/installed-printers`). */
async function installPrinter(): Promise<void> {
  const current = (await (await fetch(`${API}/api/installed-printers`)).json()) as InstalledPrinter[];
  if (current.some((i) => i.modelId === MODEL && i.variant === VARIANT)) return;
  const res = await fetch(`${API}/api/installed-printers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([...current, { vendorId: VENDOR, modelId: MODEL, variant: VARIANT }]),
  });
  if (!res.ok) throw new Error(`installing ${MODEL}/${VARIANT} failed with ${res.status}`);
  console.log(`     installed ${MODEL}/${VARIANT} in ${API} (what the setup wizard does)`);
}

// ---------------------------------------------------------------------------
if (!TOKEN) {
  console.error('MCP_TOKEN is required (the token of the server under test)');
  process.exit(2);
}

// ---- AC-1: the endpoint exists only with a configured token ----------------
console.log(`\n== ${URL_MCP} ==`);
if (EXPECT_DISABLED) {
  const noAuth = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  check('AC-1 without a configured token /mcp answers 404', noAuth.status === 404, {
    status: noAuth.status,
    body: noAuth.text.slice(0, 200),
  });
  const withAuth = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, TOKEN);
  check('AC-1 also with a token, when none is configured', withAuth.status === 404, { status: withAuth.status });
  report();
}

const missing = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
check('AC-1 a request without a token answers 401', missing.status === 401, { status: missing.status });
const wrong = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }, 'definitely-not-the-token');
check('AC-1 a wrong token answers 401', wrong.status === 401, { status: wrong.status });

// ---- AC-5: the tools and their schemas -------------------------------------
const client = await connect(TOKEN);
const listed = await client.listTools();
const names = listed.tools.map((t) => t.name);
check('AC-5 all tools are listed', TOOL_NAMES.every((n) => names.includes(n)) && names.length === TOOL_NAMES.length, {
  expected: TOOL_NAMES,
  got: names,
});
check(
  'AC-5 every tool brings a JSON Schema',
  listed.tools.every((t) => !!t.inputSchema && t.inputSchema.type === 'object'),
  listed.tools.map((t) => ({ name: t.name, schema: t.inputSchema?.type })),
);
check(
  'AC-5 read-only tools are annotated as such',
  ['webslicer.list_printers', 'webslicer.list_presets', 'webslicer.get_option_schema', 'webslicer.list_library', 'webslicer.get_job'].every(
    (n) => listed.tools.find((t) => t.name === n)?.annotations?.readOnlyHint === true,
  ),
);
for (const t of listed.tools)
  console.log(`     ${t.name} (${Object.keys((t.inputSchema as { properties?: object }).properties || {}).join(', ') || 'no arguments'})`);

// ---- the workflow of AC-2 ---------------------------------------------------
await installPrinter();
const printers = await call(client, 'webslicer.list_printers');
check('AC-2 list_printers finds the installed MK4S', printers.ok && JSON.stringify(printers.printers ?? []).includes('MK4S'), printers);
const printerEntry = (printers.printers as Array<{ presets: string[] }> | undefined)?.find((p) => p.presets.includes(PRINTER));
check('AC-2 the MK4S printer preset name is offered', !!printerEntry, { printer: PRINTER, printers: printers.printers });

const prints = await call(client, 'webslicer.list_presets', { type: 'print', printer: PRINTER });
check(
  'AC-2 list_presets offers the print preset',
  prints.ok && (prints.presets as Array<{ name: string }> | undefined)?.some((p) => p.name === PRINT) === true,
  { print: PRINT, type: prints.type },
);

const library = await call(client, 'webslicer.list_library', { path: 'samples' });
check(
  'AC-2 list_library shows the calibration cube',
  library.ok && (library.entries as Array<{ path: string }> | undefined)?.some((e) => e.path === SAMPLES) === true,
  { samples: SAMPLES, entries: library.entries },
);

const options = await call(client, 'webslicer.get_option_schema', { query: 'fill_density' });
check(
  'AC-2 get_option_schema knows fill_density',
  options.ok && (options.options as Array<{ key: string }> | undefined)?.[0]?.key === 'fill_density',
  options,
);

const project = await call(client, 'webslicer.create_project', { printer: PRINTER, print: PRINT, filaments: [FILAMENT] });
const projectId = project.project_id as string;
check('AC-2 create_project answers a project id', project.ok && typeof projectId === 'string' && projectId.length === 36, project);

const added = await call(client, 'webslicer.add_model', { project_id: projectId, library_path: SAMPLES, copies: 2 });
const addedObjects = (added.objects as Array<{ instances: number; name: string }> | undefined) ?? [];
check('AC-2 add_model stores the cube as two instances', added.ok && addedObjects.length === 1 && addedObjects[0].instances === 2, added);

const arranged = await call(client, 'webslicer.arrange', { project_id: projectId });
check('AC-2 arrange packs them on the bed', arranged.ok && (arranged.objects as unknown[])?.length === 1, arranged);

const setting = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'print', values: { fill_density: '30%' } });
check('AC-2 set_settings applies the infill', setting.ok && (setting.changed as Record<string, string>)?.fill_density === '30%', setting);
const quick = await call(client, 'webslicer.quick_settings', { project_id: projectId, supports: 'everywhere', brim: true });
check(
  'AC-2 quick_settings sets supports and brim',
  quick.ok &&
    (quick.changed as Record<string, string>)?.support_material === '1' &&
    (quick.changed as Record<string, string>)?.brim_width === '5',
  quick,
);
const badSetting = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'print', values: { no_such_option: '1' } });
check('AC-2 an unknown option is rejected', !badSetting.ok && /Unknown option/.test(badSetting.error || ''), badSetting);
const badType = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'filament', values: { layer_height: '0.2' } });
check(
  'AC-2 an option of another preset type is rejected',
  !badType.ok && /not a filament preset option/.test(badType.error || ''),
  badType,
);

// ---- S1-a: the setting guardrails (T-025) -----------------------------------
// The MK4S PLA preset carries 230 °C, so +40 °C (270) is outside the ±25 °C band and +20 °C (250) inside.
const tooHot = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'filament', values: { temperature: '270' } });
check(
  'S1-a a temperature 40 °C above the preset is rejected with its band',
  !tooHot.ok && /outside the band/.test(tooHot.error || '') && /205–255 °C/.test(tooHot.error || ''),
  tooHot,
);
const startGcode = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'print', values: { start_gcode: 'G28' } });
check(
  'S1-a start_gcode is rejected by the allowlist',
  !startGcode.ok && /G-code and script options cannot be set through MCP/.test(startGcode.error || ''),
  startGcode,
);
const zOffset = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'printer', values: { z_offset: '0.2' } });
check('S1-a z_offset (printer scope) is rejected', !zOffset.ok && /Printer options cannot be set/.test(zOffset.error || ''), zOffset);
const mixed = await call(client, 'webslicer.set_settings', {
  project_id: projectId,
  scope: 'filament',
  values: { temperature: '290', start_gcode: 'G28' },
});
check(
  'S1-a one failing key rejects the whole call and lists every issue',
  !mixed.ok && /temperature: 290/.test(mixed.error || '') && /start_gcode: G28/.test(mixed.error || ''),
  mixed,
);
const dryRun = await call(client, 'webslicer.check_settings', { project_id: projectId, scope: 'filament', values: { temperature: '250' } });
check('S1-a check_settings: +20 °C is ok', dryRun.ok && dryRun.ok === true && JSON.stringify(dryRun.issues) === '[]', dryRun);
const dryHot = await call(client, 'webslicer.check_settings', { project_id: projectId, scope: 'filament', values: { temperature: '270' } });
check(
  'S1-a check_settings reports the band without applying it',
  dryHot.ok && dryHot.ok === false && /outside the band/.test(JSON.stringify(dryHot.issues)),
  dryHot,
);
const accepted = await call(client, 'webslicer.set_settings', { project_id: projectId, scope: 'filament', values: { temperature: '250' } });
check(
  'S1-a a temperature 20 °C above the preset is accepted',
  accepted.ok && (accepted.changed as Record<string, string>)?.temperature === '250',
  accepted,
);

const sliced = await call(client, 'webslicer.slice', { project_id: projectId });
const jobId = sliced.job_id as string;
check('AC-2 slice answers a job id', sliced.ok && typeof jobId === 'string', sliced);

let job: Record<string, unknown> = {};
for (let i = 0; i < 120; i++) {
  job = await call(client, 'webslicer.get_job', { job_id: jobId });
  const status = job.status as string;
  if (status === 'done' || status === 'error' || status === 'cancelled') break;
  await sleep(2000);
}
const result = (job.result ?? {}) as Record<string, unknown>;
check('AC-2 the job finishes', job.status === 'done', { status: job.status, error: job.error, warnings: job.warnings });
check(
  'AC-2 the result reports time, filament and layers',
  typeof result.time === 'string' && Number(result.filament_mm) > 0 && Number(result.layers) > 0,
  result,
);
check('AC-2 the result weighs the filament', Number(result.filament_g) > 0 && Number(result.filament_cost) > 0, {
  filament_g: result.filament_g,
  filament_cost: result.filament_cost,
});
const gcode = await fetch(`${API}/api/jobs/${jobId}/gcode`);
check('AC-2 the G-code exists in the job', gcode.status === 200 && Number(gcode.headers.get('content-length') ?? 0) > 0, {
  status: gcode.status,
  size: gcode.headers.get('content-length'),
});
console.log(
  `     time ${result.time}, filament ${result.filament_mm} mm / ${result.filament_g} g, ${result.layers} layers, ${result.size_bytes} bytes`,
);

// ---- AC-3: another owner sees nothing of that project -----------------------
if (TOKEN_B) {
  if (TOKENS_FILE && fs.existsSync(TOKENS_FILE)) {
    const list = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')) as Array<{
      id: string;
      name: string;
      owner: string;
      hash: string;
      createdAt: string;
    }>;
    if (!list.some((t) => t.id === 'e2e-token-b')) {
      list.push({ id: 'e2e-token-b', name: 'E2E token B', owner: 'e2e-b', hash: hashToken(TOKEN_B), createdAt: new Date().toISOString() });
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(list, null, 2));
      console.log('     added the second token to the token file (what a user does by hand in phase 1)');
    }
  }
  const other = await connect(TOKEN_B);
  const peek = await call(other, 'webslicer.add_model', { project_id: projectId, library_path: SAMPLES });
  check("AC-3 token B cannot add to token A's project", !peek.ok && /not found/.test(peek.error || ''), peek);
  const sliceB = await call(other, 'webslicer.slice', { project_id: projectId });
  check("AC-3 token B cannot slice token A's project", !sliceB.ok && /not found/.test(sliceB.error || ''), sliceB);
  const own = await call(other, 'webslicer.create_project', { printer: PRINTER, print: PRINT });
  check('AC-3 token B gets a project of its own owner', own.ok && own.owner === 'e2e-b', own);
  await other.close();
}

// ---- AC-4: the audit log ----------------------------------------------------
const audit = fs.existsSync(AUDIT_LOG) ? fs.readFileSync(AUDIT_LOG, 'utf8') : '';
const lines = audit.split('\n').filter(Boolean);
const entries = lines.map((l) => JSON.parse(l) as { tool: string; ok: boolean; owner: string; params?: unknown; error?: string });
const called = [
  'webslicer.list_printers',
  'webslicer.create_project',
  'webslicer.add_model',
  'webslicer.arrange',
  'webslicer.set_settings',
  'webslicer.quick_settings',
  'webslicer.slice',
  'webslicer.get_job',
];
check(
  'AC-4 every tool call is in the audit log',
  called.every((t) => entries.some((e) => e.tool === t)),
  { missing: called.filter((t) => !entries.some((e) => e.tool === t)), entries: entries.length },
);
check(
  'AC-4 a failed call is logged as failed',
  entries.some((e) => !e.ok && /Unknown option/.test(e.error || '')),
  entries.filter((e) => !e.ok).slice(-3),
);
check('AC-4 no token in the audit log', !!TOKEN && !audit.includes(TOKEN) && (!TOKEN_B || !audit.includes(TOKEN_B)));
check(
  'AC-4 the log carries the owner, not the token',
  entries.every((e) => typeof e.owner === 'string' && e.owner.length > 0),
);
check(
  'AC-4 no API key or Authorization header in the log',
  !/bearer\s|api[-_]?key["':]\s*"[^"]/i.test(audit),
  audit
    .split('\n')
    .filter((l) => /bearer|api[-_]?key/i.test(l))
    .slice(0, 3),
);
console.log(`     ${entries.length} audit entries in ${AUDIT_LOG}`);
console.log(`     last: ${JSON.stringify(entries[entries.length - 1])}`);

await client.close();
report();

function report(): never {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} / ${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
