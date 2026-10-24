/**
 * Locating the app by its stable test hooks (`data-testid`).
 *
 * The layout tasks move the sidebar, the tool bar and the top bar between regions; a spec that
 * selected `.sidebar .quick-settings` or a button by its place in a container would break on each
 * move. The hooks name the role of an element, not its place, so the same locator keeps working
 * after the move. Playwright's `testIdAttribute` is set explicitly in `playwright.config.ts`, which
 * is what `getByTestId` reads; `byId` is the short form of that.
 *
 * Field labels, button texts and ARIA roles do not depend on position and stay as they are.
 */
import type { Locator, Page } from '@playwright/test';

/** One element (or all of them) with the given hook, e.g. `byId(page, 'tool-panel')`. */
export function byId(page: Page, id: string): Locator {
  return page.getByTestId(id);
}
