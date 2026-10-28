import assert from 'node:assert/strict';
import { test } from 'node:test';
import { columnCount, isHighFlow, variantGrid, variantLabel } from './variants.js';

/** The full label of a cell as the checkbox spells it, for the assertions below. */
const text = (c: { label: string; unit: string }) => (c.unit ? `${c.label} ${c.unit}` : c.label);

test('the high-flow prefixes the bundle uses are recognised', () => {
  assert.equal(isHighFlow('HF0.4'), true);
  assert.equal(isHighFlow('HF 0.4'), true);
  assert.equal(isHighFlow('hf0.6'), true);
  assert.equal(isHighFlow('0.4'), false);
  assert.equal(isHighFlow('volcano 0.6'), false);
});

test('a variant label drops the HF prefix and spells out millimetres', () => {
  assert.equal(variantLabel('HF0.4'), '0.4 mm');
  assert.equal(variantLabel('0.4'), '0.4 mm');
  assert.equal(variantLabel('Volcano 0.4'), 'Volcano 0.4');
  assert.equal(variantLabel('default'), 'default');
});

test('the CORE One bundle variants form two aligned rows, each ordered by nozzle', () => {
  const grid = variantPartsOf(['HF0.4', 'HF0.5', 'HF0.6', 'HF0.8', '0.25', '0.3', '0.4', '0.5', '0.6', '0.8']);
  assert.deepEqual(grid.standard, ['0.25 mm', '0.3 mm', '0.4 mm', '0.5 mm', '0.6 mm', '0.8 mm']);
  assert.deepEqual(grid.highFlow, ['0.4 mm', '0.5 mm', '0.6 mm', '0.8 mm']);
});

test('the grid keeps the bundle values, so an installed printer still matches its variant', () => {
  const grid = variantGrid(['HF0.4', '0.4']);
  assert.deepEqual(
    grid.highFlow.map((c) => c.value),
    ['HF0.4'],
  );
  assert.deepEqual(
    grid.standard.map((c) => c.value),
    ['0.4'],
  );
});

test('a model without high flow has one row, and an empty bundle has none', () => {
  assert.deepEqual(variantGrid(['0.4', '0.6']).highFlow, []);
  assert.deepEqual(variantGrid([]), { standard: [], highFlow: [] });
});

test('a bundle that mixes the rows is split and both rows sort numerically', () => {
  const grid = variantGrid(['0.4', '0.25', 'HF0.5', '0.3', '0.5', 'HF0.4', '0.6', '0.8', 'HF0.6', 'HF0.8']);
  assert.deepEqual(
    grid.standard.map((c) => c.value),
    ['0.25', '0.3', '0.4', '0.5', '0.6', '0.8'],
  );
  assert.deepEqual(
    grid.highFlow.map((c) => c.value),
    ['HF0.4', 'HF0.5', 'HF0.6', 'HF0.8'],
  );
});

test('the grid columns are the widest row of the listed models', () => {
  assert.equal(columnCount([{ variants: ['0.4', '0.6'] }, { variants: ['0.4', '0.25', '0.3', 'HF0.4'] }]), 3);
  assert.equal(columnCount([]), 1);
});

/** The cells of a grid as their full labels, one list per row. */
function variantPartsOf(variants: string[]) {
  const grid = variantGrid(variants);
  return { standard: grid.standard.map(text), highFlow: grid.highFlow.map(text) };
}
