/**
 * B11: the bed editor kept its own state after the option changed. Switching the printer left the
 * previous printer's bed shape in the field, and the blur wrote it back onto the new printer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncBedEditor } from './OptionField';

const RECT = '0x0,250x0,250x210,0x210';
const POLY = '0x0,100x0,200x50,100x100,0x100';

test('B11: the bed editor re-reads the bed shape after a printer switch', () => {
  assert.deepEqual(syncBedEditor(POLY, RECT, { text: RECT, custom: false }), { text: POLY, custom: true });
  assert.deepEqual(syncBedEditor(RECT, POLY, { text: POLY, custom: true }), { text: RECT, custom: false });
});

test('B11: a re-render with the same value keeps what the user typed', () => {
  assert.deepEqual(syncBedEditor(RECT, RECT, { text: 'lyping…', custom: true }), { text: 'lyping…', custom: true });
});
