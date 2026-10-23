/**
 * The API and domain types of WebSlicer, declared exactly once (R-2, guideline §3).
 *
 * `web/src/api.ts` re-exports them all, the server modules import what they need, so a field added
 * here reaches both sides without a second edit.
 */
export * from './common.js';
export * from './jobs.js';
export * from './presets.js';
export * from './schema.js';
export * from './server.js';
export * from './cut.js';
