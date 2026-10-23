/**
 * Seed the library with the bundled sample models on first start (empty library).
 *
 * STL and STEP samples are copied: the STEP one (T-009) lets a user try the conversion without a
 * CAD export of their own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/** The sample formats the library gets on first start. */
const SAMPLE_EXT = ['.stl', '.step', '.stp'];

export function seedSamples(): void {
  const candidates = [process.env.SAMPLES_DIR, path.resolve(process.cwd(), 'samples'), '/app/samples'].filter((x): x is string => !!x);
  const src = candidates.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.toLowerCase().endsWith('.stl')));
  if (!src) return;
  const target = path.join(config.libraryDir, 'samples');
  let libraryEmpty = true;
  try {
    libraryEmpty = fs.readdirSync(config.libraryDir).filter((f) => !f.startsWith('.')).length === 0;
  } catch {
    /* ignore */
  }
  if (!libraryEmpty || fs.existsSync(target)) return;
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const f of fs.readdirSync(src)) {
      if (!SAMPLE_EXT.some((e) => f.toLowerCase().endsWith(e))) continue;
      fs.copyFileSync(path.join(src, f), path.join(target, f));
    }
    console.log(`[webslicer] sample models copied to ${target}`);
  } catch (e) {
    console.warn(`[webslicer] could not seed samples: ${(e as Error).message}`);
  }
}
