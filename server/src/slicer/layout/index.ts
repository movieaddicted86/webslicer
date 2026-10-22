/**
 * Curated UI layout mirroring PrusaSlicer's settings tabs, plus metadata for well-known options.
 * Keys that do not exist in the installed slicer version are dropped at runtime; keys the slicer
 * knows but the tables do not are added to an "Other options" page automatically.
 */
export { LAYOUT_FFF } from './fff.data.js';
export { KNOWN_OPTIONS } from './knownOptions.data.js';
export { PRINT_VECTOR_KEYS, PRINTER_STRING_VECTOR_KEYS, PRINTER_VECTOR_KEYS } from './keySets.js';
export type { KnownOption, Tab } from './types.js';
