/**
 * SEC-1 (T-024): options a client must never be able to set, because PrusaSlicer acts on them
 * *on the server*.
 *
 * The pin. `post_process` is a list of shell commands PrusaSlicer runs on the host after the G-code
 * export (verified: `PrusaSlicer-2.9.6` logs "A post-processing script has been detected in the
 * config data … Continue(Y/N)?" and runs it through `/bin/sh` once the prompt is answered);
 * `output_filename_format` names the output file, so a `../` in it escapes the job directory
 * (verified: the slicer wrote to `/tmp/sec1-escape.gcode` from a `../../../../tmp/…` format).
 *
 * Neither key is client input in any legitimate flow – both come from a preset the *user* chose,
 * which is why they are dropped server-side rather than rejected (see `services/serverOnly.ts`).
 *
 * Written before the fix: `mergeConfigs` still copies both keys on this commit, so the assertions
 * below fail here. The next commit strips them in `mergeConfigs` and makes this file pass without
 * changing what it expects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY, SERVER_ONLY_KEYS, type Schema, type SliceRequest } from '@webslicer/shared';
import { mergeConfigs } from './configMerge.js';

/** The keys the server must never pass on to the slicer – the list under test. */
const DENIED = [...SERVER_ONLY_KEYS];

/**
 * A schema with the two denied keys, so `mergeConfigs` treats them like the real one does: both are
 * `string`/`strings` print options, and neither is a per-extruder vector except `post_process`.
 */
const SCHEMA = {
  slicerVersion: 'test',
  layout: [],
  presetKeys: { print: [], filament: [], printer: [], sla_print: [], sla_material: [] },
  options: {
    post_process: {
      key: 'post_process',
      label: 'Post-processing scripts',
      tooltip: '',
      category: 'Misc',
      type: 'strings',
      default: '',
      presetTypes: ['print'],
      technology: 'FFF',
    },
    output_filename_format: {
      key: 'output_filename_format',
      label: 'Output filename format',
      tooltip: '',
      category: 'Misc',
      type: 'string',
      default: '[input_filename_base].gcode',
      presetTypes: ['print', 'sla_print'],
      technology: 'FFF',
    },
    layer_height: {
      key: 'layer_height',
      label: 'Layer height',
      tooltip: '',
      category: 'Layers',
      type: 'float',
      default: '0.2',
      presetTypes: ['print'],
      technology: 'FFF',
    },
  },
} as never as Schema;

const MARKER = 'touch /tmp/sec1-marker';
const ESCAPE = '../../../../tmp/sec1-escape.gcode';

/** A slice request that carries both denied keys in every slot a client can write to. */
function request(top: Partial<SliceRequest> = {}): SliceRequest {
  return {
    objects: [{ modelId: '11111111-1111-1111-1111-111111111111', name: 'cube', transform: [...IDENTITY] }],
    print: { name: 'p', config: { post_process: MARKER, output_filename_format: ESCAPE, layer_height: '0.25' } },
    printer: { name: 'pr', config: { post_process: MARKER, output_filename_format: ESCAPE, layer_height: '0.2' } },
    filaments: [{ name: 'f', config: { post_process: MARKER, output_filename_format: ESCAPE, layer_height: '0.1' } }],
    ...top,
  } as SliceRequest;
}

test('a REST slice request cannot smuggle post_process into the merged config', () => {
  const merged = mergeConfigs(SCHEMA, request());
  assert.equal(merged.post_process, undefined, 'post_process reached the PrusaSlicer config');
  assert.equal(merged.output_filename_format, undefined, 'output_filename_format reached the PrusaSlicer config');
  // the denial is narrow: the rest of the config is merged as before
  assert.equal(merged.layer_height, '0.1', 'a filament option stays the per-extruder vector, as before');
  assert.equal(merged.print_settings_id, 'p');
  assert.equal(merged.printer_settings_id, 'pr');
});

test('every merge path is covered: slicer run, 3MF export, config export and autosave', () => {
  // `/api/export/3mf`, `/api/export/config` and `/api/autosave/:client` pass `forProject: true`;
  // `/api/slice`, `/api/projects/:id/slice` and the MCP `slice` tool go through `createJob` with the
  // default. Both land in this one function, so both are checked here.
  for (const forProject of [true, false]) {
    const merged = mergeConfigs(SCHEMA, request(), { forProject });
    for (const key of DENIED) {
      assert.equal(merged[key], undefined, `${key} survived (forProject: ${forProject})`);
    }
  }
});

test('a project preset config cannot smuggle them either', () => {
  // `resolvedConfigs` merges the stored overrides over the resolved preset, so a project created
  // through `/api/projects` carries the key into the same `mergeConfigs` call.
  const merged = mergeConfigs(SCHEMA, request({ outputName: 'sec1' }));
  for (const key of DENIED) assert.ok(!(key in merged), `${key} reached the PrusaSlicer config`);
});

test('the denial is a copy: the caller keeps the config it passed in', () => {
  const body = request();
  mergeConfigs(SCHEMA, body);
  assert.equal(body.print.config.post_process, MARKER, 'the request must not be mutated');
});
