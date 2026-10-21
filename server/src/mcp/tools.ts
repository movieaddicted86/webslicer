/**
 * MCP tool catalogue (concept `docs/MCP-Concept.md` §4, phase 1).
 *
 * Deliberately transport-free: `server.ts` binds these definitions to the Streamable HTTP endpoint,
 * and the stdio wrapper of phase 4 can reuse the very same list. Every tool works on the modules the
 * browser uses (presets, library, `services/projects.ts`, the job queue) and is scoped to the owner of
 * the token that called it.
 *
 * Split by topic since T-025 – the catalogue was 560 lines before the safety rules of S1-a were added:
 *
 * | Module            | Tools                                                    |
 * | ----------------- | -------------------------------------------------------- |
 * | `toolCatalog.ts`  | list_printers, list_presets, get_option_schema, list_library |
 * | `toolProjects.ts` | create_project, add_model, arrange                       |
 * | `settings.ts`     | set_settings, check_settings, quick_settings             |
 * | `toolJobs.ts`     | slice, get_job                                           |
 */
import { catalogTools } from './toolCatalog.js';
import { projectTools } from './toolProjects.js';
import { settingsTools } from './settings.js';
import { jobTools } from './toolJobs.js';
import type { AnyTool } from './toolTypes.js';

export const TOOLS: AnyTool[] = [...catalogTools, ...projectTools, ...settingsTools, ...jobTools];

/** Tool names in catalogue order (used by the E2E script and the docs). */
export const TOOL_NAMES: string[] = TOOLS.map((t) => t.name);
