/**
 * Vendor sweep of the configuration limits (S1-d, T-032).
 *
 * Q-005 made this mandatory: the global limits of `shared/src/safety/configLimits.ts` are typo catchers
 * for *user* input, so they must never fire on a preset PrusaSlicer ships. This script runs them over
 * every bundled system preset of the installed PrusaSlicer (2.9.6 in the image) and answers:
 *
 * - how many presets of each type were scanned,
 * - how many issues each rule found,
 * - and every single preset that would **block** – such a preset means the limit is wrong and has to be
 *   widened, not that the preset is bad.
 *
 * The soft ranges are warnings by design ("PLA at 265 °C is unusual") and are reported the same way: a
 * shipped preset that warns shows where the window is still too narrow for real material variants.
 *
 * A print preset's `layer_height` is checked against the nozzle of every printer preset it is
 * compatible with (the same compatibility rules the preset list uses), because "not above the nozzle"
 * is a relation between two presets, not a property of one.
 *
 * Usage, from the repository root:
 *
 *   PRUSASLICER_PROFILES=/opt/prusaslicer/usr/resources/profiles npx tsx server/scripts/limits-sweep.ts
 *
 * `PRUSASLICER_RESOURCES` works too: its `profiles` subdirectory is used when `PRUSASLICER_PROFILES` is
 * unset. Without either the loader looks in the places `server/src/config.ts` knows (a local
 * PrusaSlicer install included). Exit code 0 = no blocks; 1 = at least one preset would block; 2 = no
 * vendor bundles found at all. Warnings do not fail the sweep.
 */
import path from 'node:path';
import { checkConfigValues, unescapeStringsCstyle, type ConfigIssue } from '@webslicer/shared';

// `config` and the bundle cache are evaluated at import time, so the environment is prepared first and
// the modules that read it are imported dynamically
if (!process.env.PRUSASLICER_PROFILES && process.env.PRUSASLICER_RESOURCES) {
  process.env.PRUSASLICER_PROFILES = path.join(process.env.PRUSASLICER_RESOURCES, 'profiles');
}
const { loadBundles } = await import('../src/slicer/bundles.js');
const { evaluateCondition } = await import('../src/slicer/condition.js');
import type { SystemPreset } from '../src/slicer/bundles.js';

interface Finding {
  type: string;
  preset: string;
  vendor: string;
  issue: ConfigIssue;
}

/** Whether a print preset may be used with a printer preset – the rule of `listPresets`. */
function compatible(print: SystemPreset, printer: SystemPreset): boolean {
  const list = print.config.compatible_printers ? unescapeStringsCstyle(print.config.compatible_printers).filter(Boolean) : [];
  if (list.length) return list.includes(printer.name);
  return evaluateCondition(print.config.compatible_printers_condition, (key) => printer.config[key]);
}

/** The nozzle diameters a printer preset defines (one per extruder). */
function nozzlesOf(printer: SystemPreset): string[] {
  return (printer.config.nozzle_diameter ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v && v.toLowerCase() !== 'nil');
}

function main(): number {
  const bundles = loadBundles();
  if (!bundles.vendors.length) {
    console.error('[sweep] no vendor bundles found – set PRUSASLICER_RESOURCES to the resources directory');
    return 2;
  }

  const findings: Finding[] = [];
  const scanned: Record<string, number> = { print: 0, filament: 0, printer: 0, sla_print: 0, sla_material: 0 };

  for (const type of ['print', 'filament', 'printer', 'sla_print', 'sla_material'] as const) {
    for (const preset of bundles.presets[type]) {
      scanned[type]++;
      for (const issue of checkConfigValues(type, preset.config)) {
        findings.push({ type, preset: preset.name, vendor: preset.vendorName, issue });
      }
    }
  }

  // layer height against the nozzle: only for the FFF print presets, against each compatible printer
  const printers = bundles.presets.printer;
  for (const print of bundles.presets.print) {
    const layer = print.config.layer_height;
    if (layer === undefined) continue;
    for (const printer of printers) {
      if (!compatible(print, printer)) continue;
      for (const nozzle of nozzlesOf(printer)) {
        for (const issue of checkConfigValues('print', { layer_height: layer }, { nozzleDiameter: nozzle })) {
          findings.push({ type: 'print', preset: `${print.name} (with ${printer.name})`, vendor: print.vendorName, issue });
        }
      }
    }
  }

  const blocks = findings.filter((f) => f.issue.severity === 'block');
  const warns = findings.filter((f) => f.issue.severity === 'warn');

  console.log(`[sweep] PrusaSlicer resources: ${bundles.resourcesDir ?? '(unknown)'}`);
  console.log(
    `[sweep] scanned ${bundles.vendors.length} vendors: ${scanned.print} print, ${scanned.filament} filament, ` +
      `${scanned.printer} printer, ${scanned.sla_print} SLA print, ${scanned.sla_material} SLA material presets`,
  );
  const byRule = new Map<string, number>();
  for (const f of findings) byRule.set(f.issue.rule, (byRule.get(f.issue.rule) ?? 0) + 1);
  if (!byRule.size) console.log('[sweep] no findings at all');
  for (const [rule, count] of [...byRule].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`[sweep]   ${rule}: ${count}`);

  if (blocks.length) {
    console.log(`[sweep] ${blocks.length} BLOCKING findings – a limit is too narrow:`);
    for (const f of blocks) console.log(`[sweep]   ${f.type} "${f.preset}" (${f.vendor}): ${f.issue.message}`);
  } else {
    console.log('[sweep] 0 blocking findings from system presets');
  }
  if (warns.length) {
    console.log(`[sweep] ${warns.length} warnings – the soft ranges of these presets are unusual:`);
    const seen = new Set<string>();
    for (const f of warns) {
      const key = `${f.issue.rule}|${f.preset}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`[sweep]   ${f.type} "${f.preset}" (${f.vendor}): ${f.issue.message}`);
    }
  }
  return blocks.length ? 1 : 0;
}

process.exitCode = main();
