/**
 * The keepalive flush of the autosave (N8c): a plater too large for a keepalive request goes to the
 * local cache, and the pending marker has to be set *before* that write starts – the page may go
 * away while the IndexedDB write is still in flight, and a start that sees no marker reads a file
 * that is one flush behind.
 *
 * The size is the byte length of the request, not the length of the JSON string: a name of umlauts
 * is twice as many bytes as characters, and the browser's keepalive limit is in bytes.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from './store';
import { pendingFlush } from './sessionCache';

const PENDING = 'webslicer.autosave.pending';

/** A tiny in-memory IndexedDB, enough for `sessionCache` (open → transaction → put). */
const stored = new Map<string, unknown>();
const indexed = {
  open: () => {
    const req: Record<string, unknown> = {};
    req.result = {
      objectStoreNames: { contains: () => true },
      transaction: () => ({
        objectStore: () => ({ put: (v: unknown, k: string) => putRequest(v, k), get: () => getRequest(), delete: () => getRequest() }),
      }),
      close: () => undefined,
    };
    queueMicrotask(() => (req.onsuccess as () => void)?.());
    return req;
  },
};

/** What the fake store did, in order: the marker's state at the moment of the write, and the value. */
const writes: Array<{ marker: string | null; request: unknown }> = [];

function putRequest(value: unknown, _key: string) {
  const req: Record<string, unknown> = {};
  // read the marker synchronously: the write must already be announced when it starts
  writes.push({ marker: localStorage.getItem(PENDING), request: (value as { request: unknown }).request });
  stored.set('pending', value);
  queueMicrotask(() => (req.onsuccess as () => void)?.());
  return req;
}

function getRequest() {
  const req: Record<string, unknown> = {};
  queueMicrotask(() => {
    req.result = stored.get('pending');
    (req.onsuccess as () => void)?.();
  });
  return req;
}

const memory = new Map<string, string>();
const localStore = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
};

/** An uploaded object whose name is `chars` umlauts: two bytes each, one UTF-16 unit each. */
function paddedObject(chars: number) {
  return {
    id: 'obj-1',
    name: `${'ä'.repeat(chars)}.stl`,
    modelId: 'm-1',
    geometry: undefined,
    size: [10, 10, 10],
    config: {},
    extruder: 0,
    visible: true,
    triangles: 12,
    instances: [{ id: 'i-1', position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
    volumes: [],
    ranges: [],
  };
}

let fetchCalls = 0;

beforeEach(() => {
  writes.length = 0;
  stored.clear();
  memory.clear();
  fetchCalls = 0;
  (globalThis as { indexedDB?: unknown }).indexedDB = indexed;
  (globalThis as { localStorage?: unknown }).localStorage = localStore;
  (globalThis as { fetch: unknown }).fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ ok: true, savedAt: new Date().toISOString() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  useStore.setState({
    objects: [],
    selectedIds: [],
    undoStack: [],
    redoStack: [],
    autosaveState: 'idle',
    autosaveError: undefined,
  });
});

const st = () => useStore.getState();

test('N8c: a request over 60 KiB by byte length goes to the cache, marker first', async () => {
  // the name appears twice in the request (object name and output name), so 20 000 umlauts are
  // ~40 000 characters but ~80 000 bytes
  useStore.setState({ objects: [paddedObject(20_000)] as never });
  const json = JSON.stringify(st().buildSliceRequest());
  assert.ok(new TextEncoder().encode(json).length > 60 * 1024, 'the request is over the byte limit');
  assert.ok(json.length < 60 * 1024, 'but under it when counted in characters');

  assert.equal(await st().autosaveNow({ keepalive: true }), false, 'no keepalive request goes out');
  assert.equal(fetchCalls, 0);
  assert.equal(writes.length, 1, 'the request went to the local cache');
  assert.ok(writes[0].marker !== null, 'the marker is written before the cache write starts');
  assert.ok(Number.isFinite(Number(writes[0].marker)), 'and carries the flush time');
  assert.notEqual(pendingFlush(), undefined, 'the next start knows a flush is pending');
  assert.equal(stored.size, 1, 'the cached entry exists');
});

test('N8c: a small request still uses the keepalive request, marker first', async () => {
  useStore.setState({ objects: [paddedObject(10)] as never });
  const realFetch = globalThis.fetch;
  const order: string[] = [];
  (globalThis as { fetch: unknown }).fetch = async (...args: Parameters<typeof fetch>) => {
    order.push(`marker=${localStorage.getItem(PENDING)}`);
    // `realFetch` counts as well; keep the total at one request
    return realFetch(...args);
  };
  assert.equal(await st().autosaveNow({ keepalive: true }), true);
  assert.equal(fetchCalls, 1, 'the request went to the server');
  assert.ok(/^marker=\d+$/.test(order[0]), `the marker was written before the request (${order[0]})`);
  assert.equal(pendingFlush(), undefined, 'and cleared once the server acknowledged it');
});
