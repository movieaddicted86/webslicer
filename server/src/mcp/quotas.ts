/**
 * Slicing quotas per MCP token (P-6).
 *
 * `MAX_JOBS` protects the CPU, but nothing protected the human queue: one agent could queue an
 * unlimited number of slices and the browser's own slice would wait behind them. A token may
 * therefore have `MCP_MAX_CONCURRENT_JOBS` jobs queued or running and may start
 * `MCP_MAX_SLICES_PER_HOUR` slices within a rolling hour. Both limits are counted per token, never
 * per owner, and the global queue stays as it is – an MCP job counts against both.
 *
 * The counters live in memory (a restart forgets them, like the authentication limiter): what is
 * limited is a burst, not a lifetime. Whether a job still occupies a slot is read from the job
 * queue, so a finished, cancelled or failed job frees its slot without a callback.
 */
import { config } from '../config.js';
import { getJob } from '../jobs.js';
import type { JobRecord } from '@webslicer/shared';

/** One rolling hour, in milliseconds. */
export const QUOTA_WINDOW_MS = 60 * 60 * 1000;

interface TokenUse {
  /** jobs this token queued, oldest first; finished ones are dropped when the next slice is checked */
  jobIds: string[];
  /** start times of the slices of the rolling window */
  slicesAt: number[];
}

const use = new Map<string, TokenUse>();

/** The status of a job, or undefined for a job that no longer exists. */
export type JobStatusLookup = (id: string) => JobRecord['status'] | undefined;

const jobStatus: JobStatusLookup = (id) => getJob(id)?.status;

function prune(use: TokenUse, now: number, statusOf: JobStatusLookup): void {
  use.jobIds = use.jobIds.filter((id) => {
    const status = statusOf(id);
    return status === 'queued' || status === 'running';
  });
  const cutoff = now - QUOTA_WINDOW_MS;
  use.slicesAt = use.slicesAt.filter((at) => at > cutoff);
}

/**
 * Why this token may not queue another slice, or undefined when it may. `now` and `statusOf` are
 * injectable so the rolling window can be tested without waiting an hour.
 */
export function quotaRefusal(tokenId: string, now = Date.now(), statusOf: JobStatusLookup = jobStatus): string | undefined {
  const used = use.get(tokenId);
  if (!used) return undefined;
  prune(used, now, statusOf);
  if (used.jobIds.length >= config.mcpMaxConcurrentJobs) {
    return `This token already has ${used.jobIds.length} slicing jobs queued or running (limit ${config.mcpMaxConcurrentJobs}). Wait for one to finish, then slice again.`;
  }
  if (used.slicesAt.length >= config.mcpSlicesPerHour) {
    return `This token has started ${used.slicesAt.length} slices within the last hour (limit ${config.mcpSlicesPerHour}). Try again later.`;
  }
  return undefined;
}

/** Count a slice that was just accepted; call it only after `createJob` returned. */
export function recordMcpSlice(tokenId: string, jobId: string, now = Date.now()): void {
  let used = use.get(tokenId);
  if (!used) {
    used = { jobIds: [], slicesAt: [] };
    use.set(tokenId, used);
  }
  used.jobIds.push(jobId);
  used.slicesAt.push(now);
}

/** Test helper: forget every counter. */
export function resetQuotas(): void {
  use.clear();
}
