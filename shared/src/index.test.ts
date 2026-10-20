import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHARED_PACKAGE_NAME } from './index.js';

test('the shared workspace package exports its marker', () => {
  assert.equal(SHARED_PACKAGE_NAME, '@webslicer/shared');
});
