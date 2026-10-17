/**
 * Seed the library with the bundled sample models on first start (empty library).
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

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
      if (!f.toLowerCase().endsWith('.stl')) continue;
      fs.copyFileSync(path.join(src, f), path.join(target, f));
    }
    console.log(`[webslicer] sample models copied to ${target}`);
  } catch (e) {
    console.warn(`[webslicer] could not seed samples: ${(e as Error).message}`);
  }
}
