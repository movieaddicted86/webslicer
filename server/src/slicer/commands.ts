/**
 * The command lines of the PrusaSlicer CLI, in one place (q2-slicer-cli).
 *
 * These are pure functions returning the exact argument array – no engine interface, no per-slicer
 * abstraction. A PrusaSlicer version change that renames or adds a flag is a change to this file,
 * and a test that pins the arrays catches an accidental edit anywhere else.
 */

/** What a slicing job exports: G-code for FFF, SL1 for SLA. */
export interface ExportGcodeArgs {
  technology: 'FFF' | 'SLA';
  configFile: string;
  outputFile: string;
  modelFile: string;
}

/** Export the job's model with the merged config. */
export function exportGcodeArgs(a: ExportGcodeArgs): string[] {
  return [
    a.technology === 'SLA' ? '--export-sla' : '--export-gcode',
    '--load',
    a.configFile,
    '--dont-arrange',
    '--loglevel',
    '3',
    '--output',
    a.outputFile,
    a.modelFile,
  ];
}

/** Convert a STEP file to a binary STL; the input keeps its `.step`/`.stp` extension. */
export function exportStlArgs(a: { outputFile: string; inputFile: string }): string[] {
  return ['--export-stl', '--no-ensure-on-bed', '--output', a.outputFile, a.inputFile];
}

/** Cut a model horizontally at `cutZ` (counted from the lowest point of the loaded file). */
export function cutArgs(a: { cutZ: number; outputFile: string; inputFile: string }): string[] {
  return ['--cut', String(a.cutZ), '--export-3mf', '--dont-arrange', '--no-ensure-on-bed', '--output', a.outputFile, a.inputFile];
}

/** The help calls the server makes: the version line and the option lists. */
export function helpArgs(tech?: 'fff' | 'sla'): string[] {
  if (!tech) return ['--help'];
  return [tech === 'fff' ? '--help-fff' : '--help-sla'];
}
