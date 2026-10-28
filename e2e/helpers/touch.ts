/**
 * Real touches for the phone project (T-092).
 *
 * `page.touchscreen.tap` only taps: a drag, a pinch and a long press need a sequence of touch points,
 * so they go through the browser's own input pipeline (`Input.dispatchTouchEvent` over CDP). Chromium
 * turns them into the pointer events the viewer listens to, with `pointerType: 'touch'` and a real
 * pointer id – the same events a finger produces. Nothing here is a synthetic `dispatchEvent`, so a
 * handler that only listens to the real path is still exercised.
 */
import type { CDPSession, Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

/** One CDP session per page: opening one per gesture would be a round trip per move. */
const sessions = new WeakMap<Page, Promise<CDPSession>>();

function session(page: Page): Promise<CDPSession> {
  let pending = sessions.get(page);
  if (!pending) {
    pending = page.context().newCDPSession(page);
    sessions.set(page, pending);
  }
  return pending;
}

const touchPoint = (p: { x: number; y: number }, id = 0) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });

async function send(page: Page, type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Array<{ x: number; y: number }>) {
  const client = await session(page);
  await client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : points.map((p, i) => touchPoint(p, i)),
  });
}

/** One finger from `from` to `to` in `steps` moves, then lifted. */
export async function touchDrag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await send(page, 'touchStart', [from]);
  for (let i = 1; i <= steps; i++) {
    await send(page, 'touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }]);
    await page.waitForTimeout(16);
  }
  await send(page, 'touchEnd', [to]);
}

/**
 * Two fingers around `centre`, starting `fromSpan` pixels apart and ending `toSpan` apart. Both move
 * symmetrically, so the midpoint stays where it is (the pinch's zoom, not its pan).
 */
export async function touchPinch(page: Page, centre: Point, fromSpan: number, toSpan: number, steps = 8): Promise<void> {
  const fingers = (span: number): Point[] => [
    { x: centre.x - span / 2, y: centre.y },
    { x: centre.x + span / 2, y: centre.y },
  ];
  await send(page, 'touchStart', fingers(fromSpan));
  for (let i = 1; i <= steps; i++) {
    await send(page, 'touchMove', fingers(fromSpan + ((toSpan - fromSpan) * i) / steps));
    await page.waitForTimeout(16);
  }
  await send(page, 'touchEnd', fingers(toSpan));
}

/** A finger that rests for `ms`, which the viewer reads as a long press, then lifts. */
export async function touchLongPress(page: Page, at: Point, ms = 750): Promise<void> {
  await send(page, 'touchStart', [at]);
  await page.waitForTimeout(ms);
  await send(page, 'touchEnd', [at]);
}

/**
 * Two taps in quick succession at the same point: the viewer's double tap.
 *
 * The four CDP calls go out **without waiting between them**: every awaited call here waits behind a
 * frame of the phone project's 780 × 1688 px SwiftShader canvas (~170 ms each), so a tap-tap sequence
 * driven one call at a time lands two *single* taps well outside the 320 ms window. Queued together,
 * the browser delivers them back to back, as a finger does.
 */
export async function touchDoubleTap(page: Page, at: Point): Promise<void> {
  const client = await session(page);
  const event = (type: 'touchStart' | 'touchEnd') => ({
    type,
    touchPoints: type === 'touchStart' ? [touchPoint(at)] : [],
  });
  await Promise.all([
    client.send('Input.dispatchTouchEvent', event('touchStart')),
    client.send('Input.dispatchTouchEvent', event('touchEnd')),
    client.send('Input.dispatchTouchEvent', event('touchStart')),
    client.send('Input.dispatchTouchEvent', event('touchEnd')),
  ]);
}

/** The centre of a locator's box, for a tap on a control. */
export async function centreOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A point of the canvas at the given fractions of its box, checked to be the canvas itself and not an
 * overlay: a touch that lands on the view bar, the sheet or the tool strip is a touch on *that* control,
 * so a gesture test has to start where the scene really receives it.
 */
export async function canvasPoint(page: Page, fx: number, fy: number): Promise<Point> {
  const box = await page.locator('.viewer canvas').boundingBox();
  if (!box) throw new Error('the viewer canvas is not rendered');
  const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  const reached = await page.evaluate(([x, y]) => !!document.elementFromPoint(x as number, y as number)?.closest('.viewer canvas'), [
    point.x,
    point.y,
  ] as const);
  if (!reached) throw new Error(`the point at ${Math.round(point.x)},${Math.round(point.y)} is covered by an overlay, not the canvas`);
  return point;
}
