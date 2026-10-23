/**
 * The project-building tools – `create_project`, `add_model` and `arrange` (concept
 * `docs/MCP-Concept.md` §4, phase 1). They work on the same server-side project store the REST
 * `/api/projects/...` routes use.
 */
import { z } from 'zod';
import { ValidationError } from '../errors.js';
import { addModelFromLibrary, arrange, createProject, listProjects, PROJECT_TTL_HOURS } from '../services/projects.js';
import { activeSchema } from '../services/schema.js';
import { arrangeOptionsSchema, copiesSchema, toPresetRef } from '../validation/projects.js';
import { loadOwnedProject, summary } from './projectAccess.js';
import { defineTool, type AnyTool } from './toolTypes.js';

const schemaOf = activeSchema;

/** live projects a single token may own */
export const MAX_PROJECTS_PER_OWNER = 20;

export const projectTools: AnyTool[] = [
  defineTool({
    name: 'webslicer.create_project',
    title: 'Create project',
    description: `Start a server-side project (a plater without a browser) for a printer, print and filament preset. It expires ${PROJECT_TTL_HOURS} h after its last use.`,
    readOnly: false,
    input: z.object({
      printer: z.string().describe('printer preset name, e.g. from list_printers'),
      print: z.string().describe('print preset name'),
      filaments: z.array(z.string()).optional().describe('filament preset names, one per extruder'),
    }),
    handler: async (args, ctx) => {
      const schema = await schemaOf();
      const live = (await listProjects()).filter((p) => p.owner === ctx.owner);
      if (live.length >= MAX_PROJECTS_PER_OWNER) {
        throw new ValidationError(
          `Too many live projects (${MAX_PROJECTS_PER_OWNER}); one of them expires ${PROJECT_TTL_HOURS} h after its last use`,
        );
      }
      const project = await createProject({
        schema,
        printer: toPresetRef(args.printer),
        print: toPresetRef(args.print),
        filaments: args.filaments?.map((name) => toPresetRef(name)),
        owner: ctx.owner,
      });
      return summary(project);
    },
  }),

  defineTool({
    name: 'webslicer.add_model',
    title: 'Add model',
    description:
      'Add a model from the library to the project (STL or 3MF; a 3MF keeps its objects and their places). `copies` repeats each model.',
    readOnly: false,
    input: z.object({
      project_id: z.string(),
      library_path: z.string().describe('path relative to the library root, e.g. "samples/calibration_cube_20mm.stl"'),
      copies: copiesSchema.optional().describe('number of copies (default 1)'),
    }),
    handler: async (args, ctx) => {
      const project = await loadOwnedProject(args.project_id, ctx.owner);
      await addModelFromLibrary(project, args.library_path, args.copies ?? 1);
      return summary(project);
    },
  }),

  defineTool({
    name: 'webslicer.arrange',
    title: 'Arrange',
    description:
      'Place every instance of the project on the bed (the same shelf packing the browser uses). Optional spacing (mm), rotations (try 0/90°) and alignment (center/corner) like the browser’s Arrange settings.',
    readOnly: false,
    input: z.object({ project_id: z.string(), ...arrangeOptionsSchema.shape }),
    handler: async (args, ctx) => {
      const { project_id, ...options } = args;
      return summary(await arrange(await loadOwnedProject(project_id, ctx.owner), await schemaOf(), options));
    },
  }),
];
