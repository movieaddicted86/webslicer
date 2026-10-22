/**
 * The pending autosave as a local cache (IndexedDB), used only for the seconds between a change and
 * its debounced server write. The server copy stays the source of truth: the cache is replayed on
 * startup when it is newer than the server's file, and dropped afterwards.
 *
 * `localStorage` is no option for this: the request carries the paint strings, which are far larger
 * than the ~5 MB a browser gives a site there, and the 3MF itself lives on the server.
 *
 * No cache is not an error: a private window, a blocked database or a unit test without IndexedDB
 * only costs the last seconds before a reload, never the session.
 */
const DB_NAME = 'webslicer-session';
const STORE = 'autosave';
const KEY = 'pending';

/** A request that has not reached the server yet, with the time the page changed it. */
export interface CachedAutosave {
  /** `Date.now()` when the flush started – compared with the server file's mtime on startup */
  savedAt: number;
  /** a `SliceRequest`; kept untyped so the cache does not have to know the API contract */
  request: unknown;
}

const available = () => typeof indexedDB !== 'undefined';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  if (!available()) return undefined;
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Remember the request of a flush that may not reach the server before the page goes away. */
export async function writeCachedRequest(savedAt: number, request: unknown): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put({ savedAt, request } satisfies CachedAutosave, KEY));
  } catch {
    /* the server autosave still has everything up to the last debounce */
  }
}

/** The cached request, or undefined when there is none (or the cache cannot be read). */
export async function readCachedRequest(): Promise<CachedAutosave | undefined> {
  try {
    const value = await withStore<CachedAutosave | undefined>('readonly', (s) => s.get(KEY));
    if (!value || typeof value.savedAt !== 'number' || value.request === undefined) return undefined;
    return value;
  } catch {
    return undefined;
  }
}

/** Drop the cache once the server has the same content. */
export async function clearCachedRequest(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    /* a stale cache is caught by its timestamp on the next start */
  }
}

/**
 * The marker of a flush that has not been acknowledged yet. `localStorage` is synchronous, so it can
 * be written while the page is going away (an IndexedDB write at `pagehide` is not reliable); the
 * next start sees it and waits for the server file to arrive before it restores. Set for the large
 * request that goes to the cache as well.
 */
const PENDING_KEY = 'webslicer.autosave.pending';

export function markPendingFlush(savedAt: number): void {
  try {
    localStorage.setItem(PENDING_KEY, String(savedAt));
  } catch {
    /* without the marker a start may read the file just before the flush lands */
  }
}

/** The time of the unacknowledged flush, or undefined when the server has everything. */
export function pendingFlush(): number | undefined {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    const at = raw === null ? NaN : Number(raw);
    return Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

export function clearPendingFlush(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}
