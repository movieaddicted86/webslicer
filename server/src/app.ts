/**
 * The Express application: the REST API under `/api`, the MCP endpoint under `/mcp`, the built
 * frontend and the single error handler that turns a thrown error into a JSON body.
 *
 * `index.ts` only boots the process around it (slicer checks, schema, job recovery); tests mount the
 * very same app on a random port, so they exercise the real middleware order.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { hostGuard } from './routes/hostGuardMiddleware.js';
import { mcpRouter } from './mcp/server.js';
import { statusOf } from './errors.js';

function serveFrontend(app: express.Express): void {
  if (fs.existsSync(config.webDist)) {
    // Hashed assets may be cached for long; index.html must always be revalidated so that
    // a new build is picked up immediately.
    app.use(
      express.static(config.webDist, {
        index: 'index.html',
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.type('text').send('WebSlicer API running. Frontend build not found (web/dist).'));
  }
}

/** Build the app: the host guard, API + MCP + static frontend + the error handler (must stay the last middleware). */
export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Before the routers and their body parsers: a rebound `Host` must not reach a handler at all (SEC-2).
  const guard = hostGuard();
  app.use('/api', guard, apiRouter());
  app.use('/mcp', guard, mcpRouter());
  serveFrontend(app);

  // The one place where a thrown error becomes an HTTP response: typed errors carry their status,
  // Express' body-parser reports oversize payloads as `entity.too.large`, everything else is a 500.
  app.use(
    (
      err: Error & { status?: number; type?: string; details?: Record<string, unknown> },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = statusOf(err) ?? err.status ?? (err.type === 'entity.too.large' ? 413 : 500);
      // S10: an unexpected error is logged in full, but a 500 body never carries its message – those
      // come from the file system, the slicer or undici and may name paths and hosts
      if (status >= 500) console.error(err);
      const message = status >= 500 ? 'Internal error' : err.message || 'Internal error';
      // typed errors may carry fields the client needs to decide (the issues of a refused send);
      // `error` stays the message so every existing reader keeps working
      res.status(status).json({ error: message, ...(status < 500 ? err.details : undefined) });
    },
  );

  return app;
}
