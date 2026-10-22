/**
 * W5: the numeric environment variables are read through here, and the fallback is what the old
 * `Number(process.env.X)` never gave – a typo used to become `NaN` and reach ports and limits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envIntegerAtLeast, envNumber, envNumberAtLeast } from './env.js';

const VAR = 'WEBSLICER_TEST_ENV_NUMBER';

function withEnv(value: string | undefined, fn: () => void): void {
  const before = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env[VAR];
    else process.env[VAR] = before;
  }
}

/** Capture the console warnings a call makes, so the test also pins that a typo is reported. */
function warningsOf(fn: () => void): string[] {
  const out: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => out.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return out;
}

test('a missing or blank variable uses the default', () => {
  withEnv(undefined, () => assert.equal(envNumber(VAR, 42), 42));
  withEnv('', () => assert.equal(envNumber(VAR, 42), 42));
  withEnv('   ', () => assert.equal(envNumber(VAR, 42), 42));
});

test('a valid number is read, including zero and a negative one', () => {
  withEnv('7.5', () => assert.equal(envNumber(VAR, 42), 7.5));
  withEnv('0', () => assert.equal(envNumber(VAR, 42), 0));
  withEnv('-3', () => assert.equal(envNumber(VAR, 42), -3));
  withEnv('1e3', () => assert.equal(envNumber(VAR, 42), 1000));
});

test('NaN and Infinity fall back to the default and say so', () => {
  for (const bad of ['abc', '10px', 'NaN', 'Infinity', '0x', '1,5']) {
    withEnv(bad, () => {
      const warnings = warningsOf(() => assert.equal(envNumber(VAR, 42), 42, `${bad} falls back`));
      assert.equal(warnings.length, 1, `${bad} is logged`);
      assert.match(warnings[0], /not a number/);
    });
  }
});

test('a value below the minimum falls back and says so', () => {
  withEnv('0', () => {
    const warnings = warningsOf(() => assert.equal(envNumberAtLeast(VAR, 1, 9), 9));
    assert.match(warnings[0], /below 1/);
  });
  withEnv('1', () => assert.equal(envNumberAtLeast(VAR, 1, 9), 1, 'the minimum itself is accepted'));
});

test('integers are floored, and a broken one still falls back', () => {
  withEnv('2.9', () => assert.equal(envIntegerAtLeast(VAR, 1, 4), 2));
  withEnv('0', () => assert.equal(envIntegerAtLeast(VAR, 1, 4), 4));
  withEnv('nope', () => warningsOf(() => assert.equal(envIntegerAtLeast(VAR, 1, 4), 4)));
});
