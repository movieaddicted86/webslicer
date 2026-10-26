/**
 * Arrange on the real outline (T-084): two L brackets, the model the plate check learned to read in
 * T-078. A plain arrangement lays their 40 mm squares one beside the other; with rotations on
 * the second bracket turns half way round, its notch faces the first one's, and the two stand in one
 * column. The test drives the real Arrange button and its gear and asserts what a user sees: the
 * block gets narrower, the plate check stays quiet and "Slice now" works. The cut halves keep landing
 * apart as before (`cut.spec.ts` pins that path).
 */
import { L_BRACKET, importFile, press, read, settle } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { click } from '../helpers/dom';

/** The footprint centres of the two L brackets and their Z rotation, rounded like the rest of the suite. */
async function placed(page: Parameters<typeof read>[0]) {
  return read(page, (s) =>
    s.objects.map((o) => {
      const round = (v: number) => Math.round(v * 1000) / 1000;
      return { x: round(o.instances[0].position[0]), y: round(o.instances[0].position[1]), z: round(o.instances[0].rotation[2]) };
    }),
  );
}

test.describe('arrange nests the real outline (T-084)', () => {
  test('two L brackets pack into a column once rotations let the second one face the first (AC-3)', async ({ app }) => {
    await importFile(app, L_BRACKET);
    await importFile(app, L_BRACKET, { clear: false });
    await settle(app, 900);
    expect(await read(app, (s) => s.objects.length)).toBe(2);

    // the default gear: no rotations, so the two squares sit side by side, one square plus spacing apart
    await press(app, 'a');
    await settle(app, 900);
    const plain = await placed(app);
    expect(
      plain.map((c) => c.z),
      'nothing turned without the setting',
    ).toEqual([0, 0]);
    const plainGap = Math.abs(plain[1].x - plain[0].x);
    expect(plainGap).toBeGreaterThan(40);

    // rotations on: the second L turns 180° and the notches face each other
    await click(app, '[data-testid="tool-arrangeSettings"]');
    await app.locator('.arrange-popover input[type="checkbox"]').check();
    await settle(app, 300);
    await click(app, '[data-testid="tool-arrange"]');
    await settle(app, 900);

    const nested = await placed(app);
    // exactly one bracket is turned half way round (cos < 0, whichever sign π comes out as)
    const turned = nested.filter((c) => Math.cos(c.z) < -0.99);
    expect(turned, `rotations: ${JSON.stringify(nested.map((c) => c.z))}`).toHaveLength(1);
    // the turned bracket stands behind the other in one column, so the block is narrower than the
    // shelf's two squares side by side
    expect(Math.abs(nested[0].x - nested[1].x), 'one column').toBeLessThan(1);
    expect(Math.abs(nested[1].y - nested[0].y), 'the column is shorter than the row was wide').toBeLessThan(plainGap - 3);

    // the outlines interlock, so the plate check has nothing to say and the plate slices as it stands
    await expect(app.locator('[data-testid="slice-panel"] .plate-issues li')).toHaveCount(0);
    await expect(app.locator('[data-testid="slice-button"]')).toBeEnabled();
  });
});
