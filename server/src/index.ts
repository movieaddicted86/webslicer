import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { SHARED_PACKAGE_NAME } from '@webslicer/shared';
import { config, ensureDirs } from './config.js';
import { getSlicerVersion, slicerAvailable } from './slicer/cli.js';
import { loadBundles } from './slicer/bundles.js';
import { getSchema } from './slicer/schema.js';
import { apiRouter } from './routes/api.js';
import { mcpRouter } from './mcp/server.js';
import { bootstrapEnvToken } from './mcp/tokens.js';
import { loadJobsFromDisk, setSchema } from './jobs.js';
import { seedSamples } from './samples.js';

async function main() {
  ensureDirs();
  console.log(`[webslicer] data dir: ${config.dataDir}`);
  console.log(`[webslicer] shared package: ${SHARED_PACKAGE_NAME}`);
  console.log(`[webslicer] slicer binary: ${config.slicerBin}`);
  console.log(`[webslicer] slicer resources: ${config.slicerResources || '(not found)'}`);

  const available = await slicerAvailable();
  if (!available) {
    console.error('[webslicer] WARNING: PrusaSlicer binary not runnable. Set PRUSASLICER_BIN. Slicing will fail.');
  } else {
    console.log(`[webslicer] slicer version: ${await getSlicerVersion()}`);
  }
  const bundles = loadBundles();
  let schema;
  try {
    schema = await getSchema(bundles.keys);
    setSchema(schema);
    console.log(`[webslicer] schema: ${Object.keys(schema.options).length} options`);
  } catch (e) {
    console.error(`[webslicer] could not build option schema: ${(e as Error).message}`);
  }
  loadJobsFromDisk();
  seedSamples();

  const tokens = bootstrapEnvToken();
  console.log(tokens ? `[webslicer] MCP: enabled (${tokens} token${tokens === 1 ? '' : 's'})` : '[webslicer] MCP: disabled (set MCP_TOKEN to enable /mcp)');

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', apiRouter());
  app.use('/mcp', mcpRouter());

  // Static frontend
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

  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Internal error' });
  });

  app.listen(config.port, config.host, () => {
    console.log(`[webslicer] listening on http://${config.host}:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
