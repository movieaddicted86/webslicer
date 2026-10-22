/**
 * MCP endpoint (`/mcp`, Streamable HTTP) – concept option A, `docs/MCP-Concept.md` §2 and §5.
 *
 * Stateless: every request carries its own `McpServer` bound to the token's owner, so no session
 * state has to be kept and a restart never leaves a client with a dangling session. Authentication
 * happens before the MCP layer sees anything: without a configured token the endpoint answers 404,
 * with a wrong or missing token 401, and a browser origin that is not the app's own 403.
 */
import express, { type Request } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools.js';
import type { ToolContext } from './toolTypes.js';
import { authenticateHeader, mcpEnabled, type McpToken } from './tokens.js';
import { appendAudit, sanitizeParams } from './audit.js';
import { appVersion } from '../services/version.js';

interface AuthedRequest extends Request {
  mcpToken?: McpToken;
}

/**
 * DNS-rebinding guard: a browser sends `Origin`, and only the app's own origin is welcome. MCP
 * clients (Claude Desktop, Claude Code, Home Assistant) send no `Origin` at all and pass.
 */
export function originAllowed(req: Request): boolean {
  const origin = req.header('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === req.header('host');
  } catch {
    return false;
  }
}

/** The tools of one request, wrapped in the audit log. */
async function createServer(ctx: ToolContext): Promise<McpServer> {
  const server = new McpServer({ name: 'webslicer', version: await appVersion() });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false },
      },
      async (args: unknown) => {
        const started = Date.now();
        const params = sanitizeParams(args ?? {});
        try {
          const data = await tool.handler(args, ctx);
          appendAudit({
            time: new Date().toISOString(),
            token: ctx.tokenId,
            owner: ctx.owner,
            tool: tool.name,
            params,
            ok: true,
            durationMs: Date.now() - started,
          });
          return { content: [{ type: 'text' as const, text: JSON.stringify(data ?? {}, null, 2) }] };
        } catch (e) {
          const message = (e as Error).message || 'tool failed';
          appendAudit({
            time: new Date().toISOString(),
            token: ctx.tokenId,
            owner: ctx.owner,
            tool: tool.name,
            params,
            ok: false,
            error: message,
            durationMs: Date.now() - started,
          });
          return { content: [{ type: 'text' as const, text: message }], isError: true };
        }
      },
    );
  }
  return server;
}

export function mcpRouter(): express.Router {
  const r = express.Router();
  const json = express.json({ limit: '4mb' });

  r.use((req, res, next) => {
    // no token configured -> the endpoint does not exist (concept §5)
    if (!mcpEnabled()) return res.status(404).json({ error: 'MCP is not enabled' });
    if (!originAllowed(req)) return res.status(403).json({ error: 'origin not allowed' });
    const token = authenticateHeader(req.header('authorization'));
    if (!token) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="webslicer"');
      return res.status(401).json({ error: 'missing or invalid bearer token' });
    }
    (req as AuthedRequest).mcpToken = token;
    next();
  });

  // Express 5 answers a rejected promise of this handler itself, so it is a plain `async` function.
  r.post('/', json, async (req, res) => {
    const token = (req as AuthedRequest).mcpToken;
    if (!token) return res.status(401).json({ error: 'missing bearer token' });
    const server = await createServer({ owner: token.owner, tokenId: token.id });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // no server-initiated messages and no sessions in stateless mode
  r.get('/', (_req, res) => res.status(405).json({ error: 'this MCP endpoint does not stream (use POST)' }));
  r.delete('/', (_req, res) => res.status(405).json({ error: 'this MCP endpoint is stateless (nothing to delete)' }));

  return r;
}
