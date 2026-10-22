/**
 * MCP endpoint (`/mcp`, Streamable HTTP) – concept option A, `docs/MCP-Concept.md` §2 and §5.
 *
 * Stateless: every request carries its own `McpServer` bound to the token's owner, so no session
 * state has to be kept and a restart never leaves a client with a dangling session. Authentication
 * happens before the MCP layer sees anything: without a configured token the endpoint answers 404,
 * with a wrong or missing token 401. The Host/Origin allowlist runs before the router (`app.ts`,
 * SEC-2) and refuses a rebound name with 403.
 */
import express, { type Request } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOOLS } from './tools.js';
import type { ToolContext } from './toolTypes.js';
import { authenticateHeader, mcpEnabled, type McpToken } from './tokens.js';
import { authBlockedFor, recordAuthFailure, recordAuthSuccess } from './authLimit.js';
import { appendAudit, sanitizeParams } from './audit.js';
import { appVersion } from '../services/version.js';

interface AuthedRequest extends Request {
  mcpToken?: McpToken;
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
    // The Host/Origin allowlist already ran in `app.ts` for /api and /mcp (SEC-2): it replaced the
    // old `Origin == Host` check, which a rebound name always passed.
    const client = req.ip || req.socket.remoteAddress || 'unknown';
    // S9: an address that keeps sending wrong tokens is answered with 429 for a minute
    const blockedFor = authBlockedFor(client);
    if (blockedFor) {
      res.setHeader('Retry-After', String(Math.ceil(blockedFor / 1000)));
      return res.status(429).json({ error: 'too many failed authentication attempts, try again later' });
    }
    const token = authenticateHeader(req.header('authorization'));
    if (!token) {
      recordAuthFailure(client);
      res.setHeader('WWW-Authenticate', 'Bearer realm="webslicer"');
      return res.status(401).json({ error: 'missing or invalid bearer token' });
    }
    recordAuthSuccess(client);
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
