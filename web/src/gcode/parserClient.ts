import type { ParsedGcode } from './types';

export function parseGcodeInWorker(text: string): Promise<ParsedGcode> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; parsed?: ParsedGcode; error?: string }>) => {
      worker.terminate();
      if (ev.data.ok && ev.data.parsed) resolve(ev.data.parsed);
      else reject(new Error(ev.data.error || 'G-code parse failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message));
    };
    worker.postMessage({ text });
  });
}
