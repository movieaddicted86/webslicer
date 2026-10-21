/**
 * The shape every MCP tool has, independent of its group (T-025 split `tools.ts` by topic).
 *
 * Deliberately transport-free: `server.ts` binds these definitions to the Streamable HTTP endpoint,
 * and the stdio wrapper of phase 4 can reuse the very same list.
 */
import { z } from 'zod';
import { ValidationError } from '../errors.js';

export interface ToolContext {
  /** owner of the token that called the tool – projects of other owners are invisible */
  owner: string;
  tokenId: string;
}

/**
 * A tool as the transport sees it: the input schema is a zod object (the SDK turns it into JSON
 * Schema and validates calls against it), the handler works on already validated arguments.
 */
export interface AnyTool {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: z.ZodObject<z.ZodRawShape>;
  handler: (raw: unknown, ctx: ToolContext) => Promise<unknown>;
}

export function defineTool<S extends z.ZodObject<z.ZodRawShape>>(def: {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  input: S;
  handler: (args: z.output<S>, ctx: ToolContext) => Promise<unknown>;
}): AnyTool {
  return {
    name: def.name,
    title: def.title,
    description: def.description,
    readOnly: def.readOnly,
    input: def.input,
    handler: (raw, ctx) => {
      // the SDK has validated the call already; this is the typed view of the same arguments
      const parsed = def.input.safeParse(raw ?? {});
      if (!parsed.success) {
        throw new ValidationError(
          `Invalid arguments: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}`,
        );
      }
      return def.handler(parsed.data, ctx);
    },
  };
}
