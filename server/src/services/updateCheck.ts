/**
 * "A new version is available": does the GitHub repository know more than this build?
 *
 * The check runs **on the server** (`GET /api/update-status` is all the browser sees), so a
 * self-hosted install without internet in the browser still learns about a new version and the
 * browser never talks to GitHub. The answer is cached in memory and in the data dir, so a restart
 * shows the last known answer. An update is a newer head of the tracked branch or a newer release
 * tag; a build without a commit only gets the tag notice; every failure is silent and keeps the last
 * observation. `WEBSLICER_UPDATE_CHECK=off` makes no request at all. Nothing here updates anything.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { appVersion } from './version.js';
import { readJson, writeJson } from '../storage/jsonStore.js';
import { isNewerVersion, parseUpdateStatus, type UpdateStatus } from '@webslicer/shared';

const execFileAsync = promisify(execFile);

/** The public repository the update check asks. */
export const UPDATE_REPO = 'movieaddicted86/webslicer';
/** The API root of the repository – one constant, so the three requests cannot drift apart. */
const API_ROOT = `https://api.github.com/repos/${UPDATE_REPO}`;
/** How long one GitHub request may take before it counts as a failure. */
export const UPDATE_TIMEOUT_MS = 5000;
/** The first check waits a minute: start-up should finish first, and a restart loop must not hammer GitHub. */
export const UPDATE_START_DELAY_MS = 60_000;
/** …and then once a day. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What one successful check saw; this is what the data dir holds between runs. */
export interface UpdateObservation {
  branch: string;
  /** the head of the tracked branch at the time of the check */
  latest: string;
  /** how many commits the branch was ahead of the commit the check ran for */
  aheadBy: number;
  /** the commit `aheadBy` was measured from (`unknown` when the build did not know it) */
  forCommit: string;
  /** the newest release tag, only when it is newer than the running version */
  tag?: string;
  checkedAt: string;
}

export interface UpdateChecker {
  /** `false` with `WEBSLICER_UPDATE_CHECK=off`: `check()` makes no request */
  readonly enabled: boolean;
  /** the last known answer; never throws and never blocks */
  status(): UpdateStatus;
  /** one check (loads the cache, asks GitHub, saves the result); resolves even when it failed */
  check(): Promise<UpdateStatus>;
  /** schedule the start-up check and the daily ones; returns the stop function */
  start(): () => void;
}

export interface UpdateCheckerOptions {
  /** the commit this build was made from, or `unknown` */
  commit: string;
  /** the branch this build follows (`GIT_BRANCH`, default `main`) */
  branch?: string;
  /** the running version (`package.json`) – a tag only counts when it is newer */
  version: string;
  /** `false` disables every outbound call */
  enabled: boolean;
  /** where the last observation is kept (data dir) */
  cacheFile: string;
  /** injected in tests; defaults to the global `fetch` */
  fetch?: typeof fetch;
  now?: () => Date;
  /** debug logging; defaults to `console.debug` (silent unless the debug output is enabled) */
  log?: (message: string) => void;
}

/** `WEBSLICER_UPDATE_CHECK` – only an explicit off value disables the check; absence means on. */
export function isUpdateCheckEnabled(value: string | undefined): boolean {
  return !['off', 'false', '0', 'no'].includes((value ?? '').trim().toLowerCase());
}

/** A GitHub commit id as the API returns it. */
const SHA = /^[0-9a-f]{7,40}$/i;

function shaOf(value: unknown): string | undefined {
  return typeof value === 'string' && SHA.test(value) ? value : undefined;
}

/**
 * The commit this build runs: the `GIT_COMMIT` build arg of the image, else `git rev-parse HEAD` of a
 * plain checkout, else `unknown`. Never throws – a missing git or repository is a normal case.
 */
export async function resolveBuildCommit(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): Promise<string> {
  const stamped = (env.GIT_COMMIT ?? '').trim();
  if (stamped && stamped !== 'unknown') return stamped;
  try {
    // fixed arguments, no shell: this reads the checkout this process runs from, nothing else
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 2000, windowsHide: true });
    return shaOf(stdout.trim()) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function parseObservation(value: unknown): UpdateObservation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.branch !== 'string' || typeof v.latest !== 'string') return undefined;
  if (typeof v.aheadBy !== 'number' || !Number.isFinite(v.aheadBy) || v.aheadBy < 0) return undefined;
  if (typeof v.forCommit !== 'string' || typeof v.checkedAt !== 'string') return undefined;
  if (v.tag !== undefined && typeof v.tag !== 'string') return undefined;
  return {
    branch: v.branch,
    latest: v.latest,
    aheadBy: v.aheadBy,
    forCommit: v.forCommit,
    checkedAt: v.checkedAt,
    ...(typeof v.tag === 'string' && v.tag ? { tag: v.tag } : {}),
  };
}

/** One checker; `createUpdateChecker` is what the tests build, the app uses the singleton below. */
export function createUpdateChecker(options: UpdateCheckerOptions): UpdateChecker {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.debug(`[webslicer] ${message}`));
  const branch = options.branch?.trim() || 'main';
  const commit = options.commit || 'unknown';

  let observation: UpdateObservation | undefined;
  let loaded = false;
  let pending: Promise<UpdateStatus> | undefined;

  async function loadCache(): Promise<void> {
    if (loaded) return;
    loaded = true;
    const { value } = await readJson<unknown>(options.cacheFile).catch(() => ({ value: undefined }));
    const cached = parseObservation(value);
    // an observation of another branch says nothing about this one
    if (cached && cached.branch === branch) observation = cached;
  }

  async function getJson(pathname: string): Promise<unknown> {
    const res = await fetchImpl(`${API_ROOT}${pathname}`, {
      headers: { 'User-Agent': 'webslicer', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS),
    });
    // 403 is GitHub's rate limit; it is a failure like being offline, not an answer
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return res.json();
  }

  /** The newest tag, when GitHub names one that is newer than the running version. */
  async function newerTag(): Promise<string | undefined> {
    const tags = await getJson('/tags?per_page=1');
    if (!Array.isArray(tags) || !tags.length) return undefined;
    const name = (tags[0] as { name?: unknown }).name;
    return typeof name === 'string' && name && isNewerVersion(name, options.version) ? name : undefined;
  }

  /** `ahead_by` of the branch over the running commit, 0 when the two cannot be compared. */
  async function commitsBehind(head: string): Promise<number> {
    if (commit === 'unknown' || head === commit) return 0;
    try {
      const compare = await getJson(`/compare/${commit}...${encodeURIComponent(branch).replace(/%2F/gi, '/')}`);
      const ahead = (compare as { ahead_by?: unknown } | undefined)?.ahead_by;
      return typeof ahead === 'number' && Number.isFinite(ahead) && ahead > 0 ? Math.floor(ahead) : 0;
    } catch (e) {
      // a commit that GitHub does not know (a fork, a local build) is not an error of the check: the
      // tag part already answered, and the next check tries again
      log(`update check: cannot compare ${commit} with ${branch}: ${(e as Error).message}`);
      return 0;
    }
  }

  async function check(): Promise<UpdateStatus> {
    if (!options.enabled) return status();
    // a second check while the first is running (start-up delay + a daily timer) shares its result
    if (pending) return pending;
    pending = (async () => {
      try {
        await loadCache();
        const head = await getJson(`/commits/${encodeURIComponent(branch).replace(/%2F/gi, '/')}`);
        const latest = shaOf((head as { sha?: unknown } | undefined)?.sha);
        if (!latest) throw new Error('the answer carried no commit id');
        const [tag, aheadBy] = await Promise.all([newerTag(), commitsBehind(latest)]);
        observation = { branch, latest, aheadBy, forCommit: commit, tag, checkedAt: now().toISOString() };
        // the cache is a convenience, not the result: a read-only data dir must not fail the check
        await writeJson(options.cacheFile, observation).catch((e: Error) => log(`update check: cannot cache: ${e.message}`));
      } catch (e) {
        // offline, rate limit, timeout: keep the last observation and stay quiet
        log(`update check failed: ${(e as Error).message}`);
      } finally {
        pending = undefined;
      }
      return status();
    })();
    return pending;
  }

  function status(): UpdateStatus {
    const latest = observation?.latest && observation.branch === branch ? observation.latest : commit;
    // the count belongs to the commit it was measured from; a rebuilt image starts without it
    const behind = observation && observation.branch === branch && observation.forCommit === commit ? observation.aheadBy : 0;
    const tag = observation && observation.branch === branch ? observation.tag : undefined;
    // a newer tag is what the user reads first – the changelog of that release, else the comparison
    const url = tag
      ? `https://github.com/${UPDATE_REPO}/releases/tag/${encodeURIComponent(tag)}`
      : `https://github.com/${UPDATE_REPO}/compare/${commit}...${encodeURIComponent(branch).replace(/%2F/gi, '/')}`;
    return {
      current: commit,
      latest,
      behind,
      url,
      checkedAt: observation?.checkedAt ?? null,
      enabled: options.enabled,
      ...(tag ? { tag } : {}),
    };
  }

  function start(): () => void {
    if (!options.enabled) return () => undefined;
    const first = setTimeout(() => void check(), UPDATE_START_DELAY_MS);
    const daily = setInterval(() => void check(), UPDATE_INTERVAL_MS);
    // the timers must never be the reason a process stays alive
    first.unref();
    daily.unref();
    return () => {
      clearTimeout(first);
      clearInterval(daily);
    };
  }

  return {
    enabled: options.enabled,
    status,
    check,
    start,
  };
}

// ---------------------------------------------------------------------------
// The app's checker (the route and `index.ts` read it)
// ---------------------------------------------------------------------------

let active: UpdateChecker | undefined;

async function defaultChecker(): Promise<UpdateChecker> {
  return createUpdateChecker({
    commit: await resolveBuildCommit(),
    branch: config.gitBranch,
    version: await appVersion(),
    enabled: isUpdateCheckEnabled(config.updateCheck),
    cacheFile: config.updateStatusFile,
  });
}

/** The answer of `GET /api/update-status` – built on first use, cached afterwards. */
export async function updateStatus(): Promise<UpdateStatus> {
  active ??= await defaultChecker();
  const status = parseUpdateStatus(active.status());
  if (!status) throw new Error('the update status does not match its contract');
  return status;
}

/** Start the start-up and daily checks (the app's `index.ts`); returns the stop function. */
export async function startUpdateCheck(): Promise<() => void> {
  active ??= await defaultChecker();
  return active.start();
}

/** Replace the app's checker (tests); `undefined` restores the configured one on the next read. */
export function setUpdateChecker(checker: UpdateChecker | undefined): void {
  active = checker;
}
