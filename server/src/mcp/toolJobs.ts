/**
 * The slicing tools – `slice` and `get_job` (concept `docs/MCP-Concept.md` §4, phase 1). They hand
 * the project to the job queue the browser uses; a headless slice carries no thumbnails.
 */
import { z } from 'zod';
import { createJob, getJob, readJobLog } from '../jobs.js';
import { NotFoundError } from '../errors.js';
import { activeSchema } from '../services/schema.js';
import { toSliceRequest, touchProject } from '../services/projects.js';
import { validateConfigLimits, validateSliceRequest } from '../services/slice.js';
import { loadOwnedProject } from './projectAccess.js';
import { defineTool, type AnyTool } from './toolTypes.js';

const schemaOf = activeSchema;

/** Warnings and errors of a finished job, from the slicer log. */
async function warningsOf(jobId: string): Promise<string[]> {
  const text = await readJobLog(jobId);
  return text
    .split('\n')
    .filter((l) => /warn|error|critical|invalid/i.test(l))
    .slice(-20)
    .map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l.trim()));
}

export const jobTools: AnyTool[] = [
  defineTool({
    name: 'webslicer.slice',
    title: 'Slice',
    description: 'Slice the project. Answers a job id; poll it with get_job (headless slices carry no thumbnails).',
    readOnly: false,
    input: z.object({ project_id: z.string() }),
    handler: async (args, ctx) => {
      const project = await loadOwnedProject(args.project_id, ctx.owner);
      const schema = await schemaOf();
      const request = toSliceRequest(project, schema);
      validateSliceRequest(request);
      // S1-d: a typo in a temperature or the nozzle is refused here like on /api/slice
      const configIssues = validateConfigLimits(request);
      const job = await createJob(request, schema, configIssues);
      await touchProject(project);
      return {
        job_id: job.id,
        status: job.status,
        output_name: job.outputName,
        technology: job.technology,
        objects: job.objectNames,
        print: job.presets.print,
        printer: job.presets.printer,
        filaments: job.presets.filaments,
        config_warnings: job.configIssues ?? [],
      };
    },
  }),

  defineTool({
    name: 'webslicer.get_job',
    title: 'Get job',
    description: 'State and result of a slicing job: status, progress, print time, filament, layers and the slicer warnings.',
    readOnly: true,
    input: z.object({ job_id: z.string() }),
    handler: async (args) => {
      const job = getJob(args.job_id);
      if (!job) throw new NotFoundError(`Job "${args.job_id}" not found`);
      const info = job.info;
      return {
        job_id: job.id,
        status: job.status,
        percent: job.percent,
        message: job.message,
        error: job.error ?? null,
        output_name: job.outputName,
        technology: job.technology,
        objects: job.objectNames,
        created_at: job.createdAt,
        finished_at: job.finishedAt ?? null,
        result:
          job.status === 'done'
            ? {
                time: info?.estimatedTime ?? null,
                time_seconds: info?.estimatedTimeSeconds ?? null,
                layers: info?.layers ?? null,
                max_z: info?.maxZ ?? null,
                filament_mm: info?.filamentUsedMm ?? null,
                filament_g: info?.totalFilamentG ?? info?.filamentUsedG ?? null,
                filament_cost: info?.totalFilamentCost ?? null,
                size_bytes: info?.sizeBytes ?? null,
              }
            : null,
        warnings: await warningsOf(job.id),
      };
    },
  }),
];
