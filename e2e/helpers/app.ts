/**
 * Driving the app: load it, read the store, import a file, press a shortcut, slice and wait.
 *
 * The suite uses the store (`window.webslicer`, exposed for debugging) for *reading* state and for the
 * actions no user gesture reaches directly (a plater command a keyboard shortcut would also reach
 * through the canvas). Interactions that a user performs – import, typing, clicking, dialogs – go
 * through the DOM, so a broken control is caught.
 */
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { E2EState } from './store-types';

/** The sample models the Docker image ships (mounted as the library on first start). */
export const SAMPLE_DIR = path.resolve('samples');
export const CUBE = path.join(SAMPLE_DIR, 'calibration_cube_20mm.stl');
export const PAIR = path.join(SAMPLE_DIR, 'cylinder_with_cube.stl');
export const BRIDGE = path.join(SAMPLE_DIR, 'bridge_table.stl');
export const PYRAMID = path.join(SAMPLE_DIR, 'stepped_pyramid.stl');
/** T-045: a 30 mm sphere – variable layer height, thin at the poles and thick at the equator. */
export const SPHERE = path.join(SAMPLE_DIR, 'sphere_30mm.stl');
/** T-078: an L bracket (40 × 40 mm, 15 mm arms) – two of them interlock with the old box check. */
export const L_BRACKET = path.join(SAMPLE_DIR, 'l_bracket.stl');
/** T-009: a 20 mm STEP cube the library seeds and the server converts with the CLI. */
export const STEP_CUBE = path.join(SAMPLE_DIR, 'calibration_cube_20mm.step');
/** A text file that is not valid STEP – the error path of the import (AC-2). */
export const BROKEN_STEP = path.resolve('e2e/fixtures/broken.step');

/** Load the app and wait until the store has its server metadata. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
  await page.waitForTimeout(1200);
}

/**
 * Open the preview of a job that another page already sliced (T-057): fetch the job record and its
 * G-code into this page instead of slicing again. A spec whose tests only *read* the sliced result
 * makes one shared slice in `beforeAll`; the per-test pages load that job.
 */
export async function openSlicedJob(page: Page, jobId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const job = (await (await fetch(`/api/jobs/${id}`)).json()) as never;
    const s = window.webslicer.getState();
    // `sliceDirty: false` + an empty log is what a slice that just finished leaves behind, so the
    // panel reads exactly as if this page had sliced the cube itself
    window.webslicer.setState({ job, sliceDirty: false, jobLog: [] });
    await s.loadGcodePreview(id);
  }, jobId);
  await settle(page, 1500);
}

/** Wait for the app again after a reload or a second tab opened the same URL. */
export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.webslicer && window.webslicer.getState().ready, null, { timeout: 90_000 });
  await page.waitForTimeout(1200);
}

/** The whole store, for the many assertions that read several fields at once. */
export async function state(page: Page): Promise<E2EState> {
  return page.evaluate(() => window.webslicer.getState());
}

/** Read one field (or a short expression result) of the store, evaluated in the page. */
export async function read<T>(page: Page, fn: (s: E2EState) => T): Promise<T> {
  return page.evaluate((source) => {
    // the callable cannot cross the process boundary; `fn` is serialised and called here
    return (eval(`(${source})`) as (s: E2EState) => T)(window.webslicer.getState());
  }, fn.toString());
}

/**
 * Import a model through the app's own file input, then wait until every object and every volume
 * carries a server model id – the upload is asynchronous, and a slice before it finished fails.
 */
export async function importFile(page: Page, file: string, { clear = true } = {}): Promise<void> {
  if (clear) await page.evaluate(() => window.webslicer.getState().clearObjects());
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await waitUploads(page);
  // the plater settles (the upload adds the object and the viewer rebuilds its meshes)
  await page.waitForTimeout(1200);
}

export async function waitUploads(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.webslicer.getState();
      return (
        s.objects.length > 0 &&
        s.objects.every((o) => o.modelId || o.uploadError) &&
        s.objects.every((o) => o.volumes.every((v) => v.modelId || v.uploadError))
      );
    },
    null,
    { timeout: 180_000 },
  );
}

/** Drop the keyboard focus first: a focused text field would swallow a shortcut. */
export async function press(page: Page, key: string): Promise<void> {
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(key);
}

/**
 * Slice from the store and wait for the preview. `previousJobId` makes the wait robust against the
 * job of an earlier spec: a new id has to appear.
 */
export async function sliceAndWait(page: Page, previousJobId: string | undefined = undefined): Promise<void> {
  const before = previousJobId ?? (await page.evaluate(() => window.webslicer.getState().job?.id));
  await page.evaluate(() => window.webslicer.getState().slice());
  await waitSliceDone(page, before);
}

/** Wait until a job other than `beforeId` finished and its toolpaths are loaded. */
export async function waitSliceDone(page: Page, beforeId: string | undefined, timeout = 600_000): Promise<void> {
  await page.waitForFunction(
    (prev) => {
      const j = window.webslicer.getState().job;
      return !!j && j.id !== prev && ['done', 'error'].includes(j.status);
    },
    beforeId,
    { timeout },
  );
  await page.waitForFunction(
    () => {
      const s = window.webslicer.getState();
      return (!!s.gcode && !s.gcodeLoading) || s.job?.status === 'error';
    },
    null,
    { timeout: 180_000 },
  );
  await page.waitForTimeout(1500);
}

/** Waits for a re-slice the app schedules itself (a G-code change, a preset switch). */
export async function waitNewJob(page: Page, beforeId: string | undefined, timeout = 300_000): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const s = window.webslicer.getState();
      return !!s.job && s.job.id !== id && s.job.status === 'done' && !!s.gcode && !s.gcodeLoading;
    },
    beforeId,
    { timeout },
  );
}

/** Delete the jobs the suite created, so a later run starts from an empty job list. */
export async function deleteAllJobs(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const jobs = (await (await fetch('/api/jobs')).json()) as Array<{ id: string }>;
    for (const j of jobs) await fetch(`/api/jobs/${j.id}`, { method: 'DELETE' });
    return jobs.length;
  });
}

/** A small REST helper running in the page, so it shares the app's origin. */
export async function rest<T>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; json: T }> {
  return page.evaluate(
    async ([m, u, b]) => {
      const res = await fetch(u as string, {
        method: m as string,
        headers: b === undefined ? {} : { 'content-type': 'application/json' },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: res.status, json: json as never };
    },
    [method, url, body] as const,
  ) as Promise<{ status: number; json: T }>;
}

/** Wait until the autosave settled – a capture or a reload mid-save would race the upload. */
export async function settle(page: Page, ms = 700): Promise<void> {
  await page
    .waitForFunction(() => window.webslicer.getState().autosaveState !== 'saving', null, { timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(ms);
}
