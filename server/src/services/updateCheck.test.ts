/**
 * T-058: the update check's rules, against a mocked GitHub (AC-1).
 *
 * The cases the task names: the same commit is no notice, a branch ahead is "N commits behind", a
 * newer tag wins, a failure (offline / 403 rate limit / timeout) is silent and keeps the last result,
 * and `WEBSLICER_UPDATE_CHECK=off` makes no request at all.
 *
 * The mock is a `fetch` function, so no network is touched and the timeout case is a fetch that
 * rejects the way `AbortSignal.timeout` does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUpdateChecker, isUpdateCheckEnabled } from './updateCheck.js';
import type { UpdateCheckerOptions, UpdateObservation } from './updateCheck.js';

const HEAD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'webslicer-update-'));
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });

/** A GitHub that answers from a table; `fail` makes a path fail the way the network or the API does. */
function github(answers: Record<string, unknown>, fail: Record<string, Error | number> = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.pathname.replace('/repos/movieaddicted86/webslicer', ''));
    const trouble = fail[url.pathname];
    if (trouble instanceof Error) throw trouble;
    if (typeof trouble === 'number') return new Response('rate limited', { status: trouble });
    const answer = answers[url.pathname];
    if (answer === undefined) throw new Error(`unexpected request ${url.pathname}`);
    return json(answer);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function checker(fetchImpl: typeof fetch, over: Partial<UpdateCheckerOptions> = {}) {
  const dir = tmp();
  const cacheFile = over.cacheFile ?? path.join(dir, 'update-status.json');
  const logs: string[] = [];
  return {
    cacheFile,
    logs,
    instance: createUpdateChecker({
      commit: OLD,
      branch: 'main',
      version: '1.0.0',
      enabled: true,
      cacheFile,
      fetch: fetchImpl,
      log: (m) => logs.push(m),
      ...over,
    }),
  };
}

test('the same commit is no update', async () => {
  const { fetchImpl } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: OLD },
    '/repos/movieaddicted86/webslicer/tags': [],
  });
  const { instance, cacheFile } = checker(fetchImpl);
  const status = await instance.check();
  assert.deepEqual(status, {
    current: OLD,
    latest: OLD,
    behind: 0,
    url: `https://github.com/movieaddicted86/webslicer/compare/${OLD}...main`,
    checkedAt: status.checkedAt,
    enabled: true,
  });
  assert.ok(status.checkedAt, 'a successful check stamps its time');
  // the result is cached in the data dir, so a restart shows it before the first check
  const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as UpdateObservation;
  assert.equal(cached.latest, OLD);
  assert.equal(cached.forCommit, OLD);
});

test('a branch that moved on answers "N commits behind" and links the comparison', async () => {
  const { fetchImpl, calls } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: HEAD },
    '/repos/movieaddicted86/webslicer/tags': [],
    [`/repos/movieaddicted86/webslicer/compare/${OLD}...main`]: { ahead_by: 3 },
  });
  const status = await checker(fetchImpl).instance.check();
  assert.equal(status.latest, HEAD);
  assert.equal(status.behind, 3);
  assert.equal(status.tag, undefined);
  assert.equal(status.url, `https://github.com/movieaddicted86/webslicer/compare/${OLD}...main`);
  // one request per endpoint, and no second check while this one runs
  assert.deepEqual(calls.sort(), ['/commits/main', `/compare/${OLD}...main`, '/tags']);
});

test('a newer release tag is what the notice shows, and it links the release', async () => {
  const { fetchImpl } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: OLD },
    '/repos/movieaddicted86/webslicer/tags': [{ name: 'v1.1.0' }],
  });
  const status = await checker(fetchImpl).instance.check();
  assert.equal(status.tag, 'v1.1.0');
  assert.equal(status.url, 'https://github.com/movieaddicted86/webslicer/releases/tag/v1.1.0');
});

test('a tag that is not newer than the running version is no notice', async () => {
  for (const name of ['v1.0.0-rc.2', 'v1.0.0-rc.1', 'v0.9.9']) {
    const { fetchImpl } = github({
      '/repos/movieaddicted86/webslicer/commits/main': { sha: OLD },
      '/repos/movieaddicted86/webslicer/tags': [{ name }],
    });
    const status = await checker(fetchImpl, { version: '1.0.0-rc.2' }).instance.check();
    assert.equal(status.tag, undefined, name);
    assert.equal(status.behind, 0, name);
  }
});

test('a build that does not know its commit gets the tag notice only', async () => {
  const { fetchImpl, calls } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: HEAD },
    '/repos/movieaddicted86/webslicer/tags': [{ name: 'v2.0.0' }],
  });
  const status = await checker(fetchImpl, { commit: 'unknown' }).instance.check();
  assert.equal(status.current, 'unknown');
  assert.equal(status.behind, 0, 'no commit-based count');
  assert.equal(status.tag, 'v2.0.0', 'the tag is still shown');
  // nothing to compare against, so the comparison endpoint is not asked
  assert.equal(
    calls.some((c) => c.includes('/compare/')),
    false,
  );
});

test('offline, a 403 and a timeout are silent and keep the last result', async () => {
  const answers = {
    '/repos/movieaddicted86/webslicer/commits/main': { sha: HEAD },
    '/repos/movieaddicted86/webslicer/tags': [],
    [`/repos/movieaddicted86/webslicer/compare/${OLD}...main`]: { ahead_by: 5 },
  };
  const good = checker(github(answers).fetchImpl);
  const first = await good.instance.check();
  assert.equal(first.behind, 5);

  const failures = [new Error('getaddrinfo ENOTFOUND'), 403, new DOMException('The operation was aborted', 'TimeoutError')];
  for (const failure of failures) {
    const failing = checker(github(answers, { '/repos/movieaddicted86/webslicer/commits/main': failure }).fetchImpl, {
      cacheFile: good.cacheFile,
    });
    // the last result comes from the cache, the failing check keeps it
    const status = await failing.instance.check();
    assert.equal(status.behind, 5, `${failure}: the last result is kept`);
    assert.equal(status.latest, HEAD);
    assert.ok(
      failing.logs.some((m) => m.startsWith('update check failed')),
      `${failure}: the failure is logged, not thrown`,
    );
  }
});

test('the cache of another branch is ignored, and a corrupt cache is not fatal', async () => {
  const dir = tmp();
  const cacheFile = path.join(dir, 'update-status.json');
  fs.writeFileSync(cacheFile, JSON.stringify({ branch: 'develop', latest: HEAD, aheadBy: 9, forCommit: OLD, checkedAt: 'x' }));
  const { fetchImpl } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: OLD },
    '/repos/movieaddicted86/webslicer/tags': [],
  });
  const status = await createUpdateChecker({
    commit: OLD,
    branch: 'main',
    version: '1.0.0',
    enabled: true,
    cacheFile,
    fetch: fetchImpl,
  }).check();
  assert.equal(status.behind, 0, 'an observation of another branch says nothing about main');
  assert.equal(status.latest, OLD);

  fs.writeFileSync(cacheFile, '{not json');
  const again = await createUpdateChecker({
    commit: OLD,
    branch: 'main',
    version: '1.0.0',
    enabled: true,
    cacheFile,
    fetch: fetchImpl,
  }).check();
  assert.equal(again.behind, 0);
});

test('a stored observation of the running commit is shown before the first check', async () => {
  const dir = tmp();
  const cacheFile = path.join(dir, 'update-status.json');
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ branch: 'main', latest: HEAD, aheadBy: 2, forCommit: OLD, checkedAt: '2026-10-23T10:00:00.000Z' }),
  );
  // a check that fails straight away, so the answer can only come from the cache
  const { fetchImpl } = github({}, { '/repos/movieaddicted86/webslicer/commits/main': new Error('offline') });
  const instance = createUpdateChecker({ commit: OLD, branch: 'main', version: '1.0.0', enabled: true, cacheFile, fetch: fetchImpl });
  const status = await instance.check();
  assert.equal(status.behind, 2);
  assert.equal(status.latest, HEAD);
  assert.equal(status.checkedAt, '2026-10-23T10:00:00.000Z');
});

test('a count measured from another commit is not carried over after a rebuild', async () => {
  const dir = tmp();
  const cacheFile = path.join(dir, 'update-status.json');
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ branch: 'main', latest: HEAD, aheadBy: 4, forCommit: 'cccccccccccccccccccccccccccccccccccccccc', checkedAt: 'x' }),
  );
  const { fetchImpl } = github({}, { '/repos/movieaddicted86/webslicer/commits/main': new Error('offline') });
  const status = await createUpdateChecker({
    commit: OLD,
    branch: 'main',
    version: '1.0.0',
    enabled: true,
    cacheFile,
    fetch: fetchImpl,
  }).check();
  assert.equal(status.behind, 0, 'the build changed, so the old distance is meaningless');
});

test('with WEBSLICER_UPDATE_CHECK=off no request is made at all', async () => {
  const { fetchImpl, calls } = github({});
  const { instance, cacheFile } = checker(fetchImpl, { enabled: false });
  const status = await instance.check();
  assert.deepEqual(calls, []);
  assert.equal(status.enabled, false);
  assert.equal(status.behind, 0);
  assert.equal(status.tag, undefined);
  assert.equal(fs.existsSync(cacheFile), false, 'nothing is written either');
  // the timers are not even created
  assert.equal(typeof instance.start(), 'function');
});

test('only an explicit off value disables the check', () => {
  for (const off of ['off', 'OFF', ' false ', '0', 'no']) assert.equal(isUpdateCheckEnabled(off), false, off);
  for (const on of [undefined, '', 'on', 'true', 'yes', '1']) assert.equal(isUpdateCheckEnabled(on), true, String(on));
});

test('the status the checker builds satisfies the shared contract', async () => {
  const { fetchImpl } = github({
    '/repos/movieaddicted86/webslicer/commits/main': { sha: HEAD },
    '/repos/movieaddicted86/webslicer/tags': [{ name: 'v1.1.0' }],
    [`/repos/movieaddicted86/webslicer/compare/${OLD}...main`]: { ahead_by: 7 },
  });
  const status = await checker(fetchImpl).instance.check();
  const { parseUpdateStatus } = await import('@webslicer/shared');
  assert.deepEqual(parseUpdateStatus(status), status);
});
