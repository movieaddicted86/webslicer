#!/usr/bin/env node
/**
 * One source of the version number (W12): the root `package.json`.
 *
 * The three workspace manifests still have to carry a version (npm writes it into the lock file and
 * the workspaces are published-like packages), but nobody edits them by hand:
 *
 *   npm run version:sync               # copy the root version into shared/, server/, web/
 *   npm run version:sync -- 1.0.0      # set a new version in every manifest at once
 *   npm run version:check              # exit 1 when the four versions disagree (CI)
 *
 * The Docker image carries no `WEBSLICER_VERSION` any more: the runtime reads `/app/package.json`,
 * which the build stage copies, so the image and the sources cannot drift apart either.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACES = ['shared', 'server', 'web'];
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function read(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeVersion(rel, version) {
  const file = path.join(ROOT, rel);
  const text = fs.readFileSync(file, 'utf8');
  // replace only the top-level `"version"` line, so formatting and key order stay untouched
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  fs.writeFileSync(file, next);
}

const rootPkg = read('package.json');
const args = process.argv.slice(2);
const check = args.includes('--check');
const wanted = args.find((a) => !a.startsWith('-'));

if (wanted) {
  if (!SEMVER.test(wanted)) {
    console.error(`version:sync: "${wanted}" is not a version (expected e.g. 1.0.0-rc.3)`);
    process.exit(1);
  }
  writeVersion('package.json', wanted);
}

const version = wanted || rootPkg.version;
const mismatched = [];
for (const ws of WORKSPACES) {
  const rel = `${ws}/package.json`;
  const current = read(rel).version;
  if (check) {
    if (current !== version) mismatched.push(`${rel} is ${current}, root is ${version}`);
    continue;
  }
  if (current !== version) {
    writeVersion(rel, version);
    console.log(`${rel}: ${current} -> ${version}`);
  }
}

if (check) {
  if (mismatched.length) {
    console.error('version:check failed – run `npm run version:sync`:\n' + mismatched.map((m) => `  ${m}`).join('\n'));
    process.exit(1);
  }
  console.log(`version:check: all manifests are ${version}`);
} else {
  console.log(`version: ${version} in the root and ${WORKSPACES.length} workspace manifests`);
}
