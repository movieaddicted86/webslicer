import { config, ensureDirs } from './config.js';
import { getSlicerVersion, slicerAvailable } from './slicer/cli.js';
import { loadBundles } from './slicer/bundles.js';
import { getSchema } from './slicer/schema.js';
import { setActiveSchema } from './services/schema.js';
import { createApp } from './app.js';
import { bootstrapEnvToken } from './mcp/tokens.js';
import { registerProjectLifecycle } from './services/projects.js';
import { loadJobsFromDisk, setSchema } from './jobs.js';
import { seedSamples } from './samples.js';

async function main() {
  ensureDirs();
  console.log(`[webslicer] data dir: ${config.dataDir}`);
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
    setActiveSchema(schema);
    console.log(`[webslicer] schema: ${Object.keys(schema.options).length} options`);
  } catch (e) {
    console.error(`[webslicer] could not build option schema: ${(e as Error).message}`);
  }
  // W3: the model life cycle is registered here instead of by importing `services/projects.ts`, so
  // the pruning that `loadJobsFromDisk` starts below already knows about live projects
  registerProjectLifecycle();
  // B11: without the await the server accepted requests before the queue had the jobs of the last
  // run, so a client could see an empty `/api/jobs` and a restart's cleanup ran behind the listener
  await loadJobsFromDisk();
  seedSamples();

  const tokens = bootstrapEnvToken();
  console.log(
    tokens
      ? `[webslicer] MCP: enabled (${tokens} token${tokens === 1 ? '' : 's'})`
      : '[webslicer] MCP: disabled (set MCP_TOKEN to enable /mcp)',
  );

  const app = createApp();

  app.listen(config.port, config.host, () => {
    console.log(`[webslicer] listening on http://${config.host}:${config.port}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
