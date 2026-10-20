/**
 * `@webslicer/shared` – pure, dependency-free TypeScript used by the web app *and* the server
 * (`docs/work-packages/CODING-GUIDELINES.md` §2). No React, no Zustand, no Express, no three.js.
 *
 * R-1 only wires the workspace package up: the API contract types move here in R-2, the placement
 * and matrix maths in R-3, packing in R-4, the PrusaSlicer value codecs and the thumbnail spec in
 * R-5. The marker below is imported by both sides and disappears with the first real module.
 */

/** Marker proving that web and server resolve the same workspace package. */
export const SHARED_PACKAGE_NAME = '@webslicer/shared';
