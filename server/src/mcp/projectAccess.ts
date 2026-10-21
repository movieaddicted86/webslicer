/**
 * Owner scoping and the compact project view of the MCP tools: every tool works on the projects of
 * the token's owner, and an agent sees a summary rather than the full file with its instance
 * matrices (`docs/MCP-Concept.md` §4).
 */
import { NotFoundError } from '../errors.js';
import { loadProject, type Project } from '../services/projects.js';

/** Load a project of this owner; everything else looks like it does not exist. */
export async function loadOwnedProject(id: unknown, owner: string): Promise<Project> {
  const project = await loadProject(String(id ?? ''));
  if (!project || project.owner !== owner) throw new NotFoundError(`Project "${String(id)}" not found`);
  return project;
}

function sizeOf(project: Project, index: number): number[] {
  const b = project.objects[index]?.bounds;
  if (!b) return [0, 0, 0];
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => Math.round(v * 100) / 100);
}

/** Compact view of a project – the full file (instance matrices) is not useful to an agent. */
export function summary(project: Project): Record<string, unknown> {
  return {
    project_id: project.id,
    owner: project.owner,
    printer: project.printer.name,
    print: project.print.name,
    filaments: project.filaments.map((f) => f.name),
    objects: project.objects.map((o, i) => ({
      object_id: o.id,
      name: o.name,
      instances: o.instances.length,
      size_mm: sizeOf(project, i),
    })),
    expires_at: project.expiresAt,
  };
}
