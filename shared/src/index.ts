/**
 * `@webslicer/shared` – pure, dependency-free TypeScript used by the web app *and* the server
 * (`docs/work-packages/CODING-GUIDELINES.md` §2). No React, no Zustand, no Express, no three.js.
 *
 * R-2 put the API contract in `src/types` (one declaration per type, shared by both sides), R-3 the
 * placement, matrix, bounds and 3MF-transform maths (`src/math`) and R-4 the plater's packing, bed
 * shape and arrangement spacing (`src/plater`); R-5 adds the rest of the PrusaSlicer value codecs
 * (`src/values.ts`) and the thumbnail spec. W4 adds the preset-type list and `safeName`
 * (`src/presets.ts`, `src/filenames.ts`).
 */
export * from './configKeys.js';
export * from './filenames.js';
export * from './math/index.js';
export * from './plater/index.js';
export * from './presets.js';
export * from './safety/index.js';
export * from './serverOnly.js';
export * from './types/index.js';
export * from './values.js';
