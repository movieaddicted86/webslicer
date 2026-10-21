/**
 * The WebSlicer version string: from the environment (Docker) or the root package.json (native
 * install). It is read once and cached, because `/api/info` and the MCP server both ask for it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

let cachedVersion: string | undefined;

/** WebSlicer version: environment (Docker) or the root package.json (native install). */
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
