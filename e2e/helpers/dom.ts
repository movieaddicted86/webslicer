/**
 * The DOM side: dialogs, the sidebar, the "DOM outline" the old t18 captures compared line by line.
 *
 * The outline is kept as a *diagnostic*: a failing assertion prints it, so the difference is visible
 * without a screenshot. The assertions themselves are roles, texts and classes.
 */
import type { Page } from '@playwright/test';

export interface DialogSnapshot {
  title: string | null;
  /** `[tag.class|title|text|value|flags]` per element – for a failure message, not for comparison */
  outline: string[];
  buttons: string[];
}

/** One line per element under `selector`, with the volatile parts (dates) normalised. */
export async function outline(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [];
    const lines: string[] = [];
    const walk = (el: Element, depth: number) => {
      const tag = el.tagName.toLowerCase();
      const cls = el.getAttribute('class') || '';
      const flags: string[] = [];
      if ((el as HTMLButtonElement).disabled) flags.push('disabled');
      if (el instanceof HTMLInputElement) {
        const type = el.getAttribute('type') || 'text';
        flags.push(`type=${type}`);
        flags.push(type === 'checkbox' || type === 'radio' ? `checked=${el.checked}` : `value=${el.value}`);
      } else if (el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        flags.push(`value=${el.value}`);
      }
      if (el instanceof HTMLOptionElement) flags.push(`selected=${el.selected}`);
      lines.push(
        `[${depth} ${tag}${cls ? '.' + cls.split(/\s+/).join('.') : ''}|${el.getAttribute('title') ?? ''}|${
          el.children.length === 0 ? el.textContent?.trim() : ''
        }|${flags.join(' ')}]`,
      );
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(root, 0);
    return lines.map((l) =>
      l
        .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<date>')
        .replace(/\d{1,4}[.\-/]\d{1,2}[.\-/]\d{1,4},? +\d{1,2}:\d{2}(:\d{2})?( ?[AP]M)?/g, '<date>'),
    );
  }, selector);
}

/** Open one of the app's dialogs the way its own menu does, and wait for it to render. */
export async function openDialog(page: Page, kind: string, payload?: unknown): Promise<void> {
  await page.evaluate(([k, p]) => window.webslicer.getState().openDialog(k as string, p), [kind, payload ?? null]);
  await page.waitForSelector('.modal', { state: 'visible', timeout: 20_000 });
  await page.waitForTimeout(400);
}

export async function closeDialog(page: Page, how: 'escape' | 'x' | 'backdrop'): Promise<void> {
  if (how === 'escape') await page.keyboard.press('Escape');
  else if (how === 'x') await page.locator('.modal-head button.icon').first().click();
  else await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } });
  await page.waitForTimeout(500);
}

/** Title, outline and button labels of the open dialog. */
export async function dialogSnapshot(page: Page): Promise<DialogSnapshot> {
  const title = await page
    .locator('.modal-head h2')
    .first()
    .textContent()
    .catch(() => null);
  return {
    title: title?.trim() ?? null,
    outline: await outline(page, '.modal'),
    buttons: (await page.locator('.modal-actions button').allInnerTexts()).map((t) => t.trim()),
  };
}

/** The current store dialog (`undefined` when none is open). */
export async function dialogKind(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.webslicer.getState().dialog);
}

/** Fill an input and wait for the app to react (the plater fields apply while typing). */
export async function fill(page: Page, selector: string, value: string, ms = 500): Promise<void> {
  await page.locator(selector).first().fill(value);
  await page.waitForTimeout(ms);
}

/** A manipulation row of the sidebar by its label. */
export function manipulationRow(page: Page, label: string) {
  return page.locator(`.manip-row:has(> span:text-is("${label}"))`).first();
}

/** Click and let the app settle. */
export async function click(page: Page, selector: string, ms = 500): Promise<void> {
  await page.locator(selector).first().click();
  await page.waitForTimeout(ms);
}
