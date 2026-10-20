/** Stable per-browser id for the server-side autosave */
export function clientId(): string {
  const key = 'webslicer.clientId';
  try {
    let id = localStorage.getItem(key);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return 'anonymous-client';
  }
}
