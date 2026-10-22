/**
 * The WebSlicer version string: the root package.json (the one source, W12). It is read once and
 * cached, because `/api/info` and the MCP server both ask for it.
 *
 * `WEBSLICER_VERSION` is still honoured as an override (a packaged build may want to stamp it), but
 * the Docker image no longer sets it: it copies the root package.json into `/app`, so the image
 * reports the same version as the sources.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

let cachedVersion: string | undefined;

/** WebSlicer version: the root package.json, unless `WEBSLICER_VERSION` overrides it. */
export async function appVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;
  cachedVersion = process.env.WEBSLICER_VERSION || process.env.npm_package_version;
  if (!cachedVersion) {
    for (const p of [path.resolve(process.cwd(), 'package.json'), path.resolve(process.cwd(), '..', 'package.json')]) {
      try {
        const pkg = JSON.parse(await fs.readFile(p, 'utf8')) as { name?: string; version?: string };
        if (pkg.name === 'webslicer' && pkg.version) {
          cachedVersion = pkg.version;
          break;
        }
      } catch {
        /* try next */
      }
    }
  }
  return (cachedVersion ||= 'unknown');
}
