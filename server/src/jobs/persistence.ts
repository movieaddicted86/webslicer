/**
 * Disk side of the slicing jobs: `DATA_DIR/jobs/<id>/` holds `request.json`, `job.json`,
 * `config.ini`, `model.3mf`, the output and `log.txt`.
 *
 * Only this module touches that directory, so the queue keeps working purely in memory and the
 * persistence rules (what is written when) are in one place.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import type { JobRecord, SliceRequest } from '@webslicer/shared';

/** Directory of one job. */
export function jobDir(id: string): string {
  return path.join(config.jobsDir, id);
}

/** Path of a file inside a job directory. */
export function jobFile(id: string, name: string): string {
  return path.join(jobDir(id), name);
}

/** Write the job record next to its files; a failure must never break the job it describes. */
export async function saveJobRecord(job: JobRecord): Promise<void> {
  try {
    await fs.writeFile(jobFile(job.id, 'job.json'), JSON.stringify(job, null, 2));
  } catch {
    /* ignore */
  }
}

/** Create the job directory and store the request that produced it. */
export async function initJobDir(id: string, req: SliceRequest): Promise<void> {
  await fs.mkdir(jobDir(id), { recursive: true });
  await fs.writeFile(jobFile(id, 'request.json'), JSON.stringify(req));
}

/** The stored request of a job. */
export async function readJobRequest(id: string): Promise<SliceRequest> {
  return JSON.parse(await fs.readFile(jobFile(id, 'request.json'), 'utf8')) as SliceRequest;
}

/** Write the PrusaSlicer config of a job. */
export async function writeJobConfig(id: string, ini: string): Promise<void> {
  await fs.writeFile(jobFile(id, 'config.ini'), ini);
}

/** Write the 3MF that is handed to the slicer. */
export async function writeJobModel(id: string, buf: Buffer): Promise<void> {
  await fs.writeFile(jobFile(id, 'model.3mf'), buf);
}

/** Write the slicer log of a job. */
export async function writeJobLog(id: string, text: string): Promise<void> {
  await fs.writeFile(jobFile(id, 'log.txt'), text);
}

/** The slicer log of a job; an unreadable log reads as empty. */
export async function readJobLog(id: string): Promise<string> {
  try {
    return await fs.readFile(jobFile(id, 'log.txt'), 'utf8');
  } catch {
    return '';
  }
}

/** Does the expected output file exist? */
export async function outputExists(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

/** Size of a file in bytes. */
export async function fileSize(file: string): Promise<number> {
  return (await fs.stat(file)).size;
}

/** Remove a single file of a job (a cancelled job keeps its log, not its temporary inputs). */
export async function removeJobFile(id: string, name: string): Promise<void> {
  try {
    await fs.rm(jobFile(id, name), { force: true });
  } catch {
    /* ignore */
  }
}

/** Remove a whole job directory (cancelled or deleted jobs). */
export async function removeJobDir(id: string): Promise<void> {
  try {
    await fs.rm(jobDir(id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/**
 * Job records of previous runs: a job that was still `queued` or `running` when the server stopped
 * can never finish, so it is loaded as an error rather than left hanging.
 */
export async function loadJobRecords(): Promise<JobRecord[]> {
  let names: string[];
  try {
    names = await fs.readdir(config.jobsDir);
  } catch {
    return [];
  }
  const out: JobRecord[] = [];
  for (const id of names) {
    const file = jobFile(id, 'job.json');
    try {
      // `readFile` answers ENOENT/EISDIR itself, so no separate existence check is needed.
      const job = JSON.parse(await fs.readFile(file, 'utf8')) as JobRecord;
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'error';
        job.error = 'Interrupted by server restart';
      }
      out.push(job);
    } catch {
      /* skip an unreadable record */
    }
  }
  return out;
}
