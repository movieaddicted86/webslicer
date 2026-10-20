/**
 * The settings UI's view of the option values. The codecs themselves live in `@webslicer/shared`
 * (`values.ts`) because the browser parses and writes the same config the server hands to the
 * slicer CLI; what stays here is `MODE_RANK`, which orders the visibility modes of the settings
 * editor and nothing else.
 *
 * The re-exports keep the existing `../values` import paths working.
 */
export {
  VECTOR_TYPES,
  decodeVector,
  encodeVector,
  escapeStringCstyle,
  escapeStringsCstyle,
  isVector,
  joinVector,
  parsePoints,
  parseThumbnailSpec,
  resizeVector,
  serializePoints,
  splitVector,
  toBool,
  unescapeStringCstyle,
  unescapeStringsCstyle,
  type ThumbnailSpec,
} from '@webslicer/shared';

/** Order of PrusaSlicer's setting visibility modes; a higher mode shows everything below it. */
export const MODE_RANK: Record<string, number> = { simple: 0, advanced: 1, expert: 2 };
