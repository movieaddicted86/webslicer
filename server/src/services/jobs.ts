/**
 * Job use cases: queue a slice request and read/control a job. The queue itself is `../jobs.js`;
 * routes and the MCP layer only see this module, so the queue stays an implementation detail.
 */
import { cancelJob, createJob, deleteJob, getJob, jobOutputPath, listJobs, readJobLog } from '../jobs.js';
import { activeSchema } from './schema.js';
import { validateConfigLimits, validateSliceRequest } from './slice.js';
import { ValidationError } from '../errors.js';
import type { JobRecord, SliceRequest } from '@webslicer/shared';

/**
 * Validate a slice request, check its configuration limits and queue it.
 *
 * The validation error is mapped to the `ValidationError` the error handler answers as the 400 the
 * slice route has always shown; the limits arrive on the job as warnings.
 */
export async function submitSliceRequest(raw: unknown): Promise<JobRecord> {
  let body: SliceRequest;
  try {
    body = validateSliceRequest(raw);
  } catch (e) {
    throw new ValidationError((e as Error).message);
  }
  const schema = await activeSchema();
  const configIssues = validateConfigLimits(body, schema);
  return createJob(body, schema, configIssues);
}

/** Every job, newest first. */
export function listJobRecords(): JobRecord[] {
  return listJobs();
}

/** One job by id, or undefined. */
export function jobById(id: string): JobRecord | undefined {
  return getJob(id);
}

/** The output file of a job (whether or not it exists). */
export function jobOutputPathOf(job: JobRecord): string {
  return jobOutputPath(job);
}

/** Ask the queue to cancel a job; false when it cannot be cancelled. */
export function cancelJobById(id: string): boolean {
  return cancelJob(id);
}

/** Delete a job and its files; false when there is no such job. */
export async function deleteJobById(id: string): Promise<boolean> {
  return deleteJob(id);
}

/** The log file text of a job. */
export async function jobLogOf(id: string): Promise<string> {
  return readJobLog(id);
}
