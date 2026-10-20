/**
 * `@webslicer/shared` – pure, dependency-free TypeScript used by the web app *and* the server
 * (`docs/work-packages/CODING-GUIDELINES.md` §2). No React, no Zustand, no Express, no three.js.
 *
 * R-2 put the API contract in `src/types` (one declaration per type, shared by both sides); R-3
 * moves the placement and matrix maths here, R-4 packing, R-5 the PrusaSlicer value codecs and the
 * thumbnail spec.
 */
export * from './types/index.js';
