/**
 * The one contract of the update notice (T-058): `UpdateStatus` and its runtime check.
 *
 * The type lives in `src/types/update.ts` like every API type; this module is its runtime
 * companion, so the server validates what it answers and the tests pin the shape without a second
 * declaration.
 *
 * `shared` is dependency-free by rule (`CODING-GUIDELINES.md` §2), so the check is hand-written
 * rather than a zod schema: the payload is produced by this repository's own service, and a single
 * small object does not justify shipping a validator into the browser bundle. The server's request
 * payloads keep their zod schemas in `server/src/validation/`.
 */
import type { UpdateStatus } from './types/update.js';

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/**
 * Read an `UpdateStatus`, or `undefined` when the value is not one.
 *
 * Unknown fields are dropped (the answer is a response, not a request): a client sees exactly the
 * contract it was promised.
 */
export function parseUpdateStatus(value: unknown): UpdateStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (!isText(v.current) || !isText(v.latest)) return undefined;
  if (typeof v.behind !== 'number' || !Number.isInteger(v.behind) || v.behind < 0) return undefined;
  if (!isText(v.url) || !/^https?:\/\//.test(v.url)) return undefined;
  if (v.checkedAt !== null && !isText(v.checkedAt)) return undefined;
  if (typeof v.enabled !== 'boolean') return undefined;
  if (v.tag !== undefined && !isText(v.tag)) return undefined;
  return {
    current: v.current,
    latest: v.latest,
    behind: v.behind,
    url: v.url,
    checkedAt: v.checkedAt,
    enabled: v.enabled,
    ...(v.tag === undefined ? {} : { tag: v.tag }),
  };
}

/** Whether the answer asks the user to update: a newer tag, or the branch ahead of the build. */
export function updateAvailable(status: UpdateStatus): boolean {
  return status.enabled && (!!status.tag || status.behind > 0);
}

/** The text of the notice ("Update available · 3 commits behind") – one wording for chip and About. */
export function updateLabel(status: UpdateStatus): string {
  const detail = status.tag ? status.tag : status.behind === 1 ? '1 commit behind' : `${status.behind} commits behind`;
  return `Update available · ${detail}`;
}

/** The numeric and pre-release parts of a version like `v1.0.0-rc.2`; `undefined` when unreadable. */
function versionParts(text: string): { numbers: number[]; pre: string[] } | undefined {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!match) return undefined;
  return { numbers: match[1].split('.').map(Number), pre: match[2] ? match[2].split('.') : [] };
}

const isNumber = (part: string) => /^\d+$/.test(part);

/**
 * Compare two versions the way semver does (`1.0.0-rc.3` > `1.0.0-rc.2`, `1.0.0` > any `1.0.0-rc.x`).
 * A leading `v` and a build suffix are ignored; an unreadable version counts as the older one.
 */
export function compareVersions(a: string, b: string): number {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 0; i < Math.max(pa.numbers.length, pb.numbers.length); i++) {
    const diff = (pa.numbers[i] ?? 0) - (pb.numbers[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  // a release is newer than a pre-release of the same number
  if (!pa.pre.length || !pb.pre.length) return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    // numeric identifiers compare as numbers and sort before alphanumeric ones (semver §11)
    if (isNumber(x) && isNumber(y)) return Number(x) > Number(y) ? 1 : -1;
    if (isNumber(x) !== isNumber(y)) return isNumber(x) ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** `candidate` names a version newer than the running `current` one. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
