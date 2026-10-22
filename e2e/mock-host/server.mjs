/**
 * A mock print host for the send tests – the only "printer" the suite ever talks to.
 *
 * It answers the endpoints the server uses for the three supported host types and appends every
 * upload it receives to `uploads.log` in `MOCK_DIR`, one JSON line per request. The spec reads that
 * file from the host (the directory is bind-mounted), so it never needs a network path back into the
 * app container:
 *
 *   OctoPrint   POST /api/files/local      (multipart: file, select, print)
 *   Moonraker   POST /server/files/upload  (multipart: file, root, print)
 *   PrusaLink   PUT  /api/v1/files/usb/<name>  (raw body, Overwrite / Print-After-Upload headers)
 *   connection  GET  /api/version (OctoPrint, PrusaLink), GET /server/info (Moonraker)
 *
 * It runs as its own container on the test network, so nothing listens on a host port and a real
 * printer is never involved.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.MOCK_PORT || 8160);
const DIR = process.env.MOCK_DIR || '/mock-data';
const LOG = path.join(DIR, 'uploads.log');

/** What the mock knows about one request, as it lands in the log. */
function record(req, body) {
  const text = body.toString('latin1');
  const filename = /filename="([^"]+)"/.exec(text)?.[1];
  // a plain form field: its part is `name="x"`, the headers, a blank line, the value
  const field = (name) => new RegExp(`name="${name}"\\r?\\n(?:[^\\r\\n]*\\r?\\n)*?\\r?\\n([^\\r\\n]*)`).exec(text)?.[1];
  const entry = {
    at: new Date().toISOString(),
    method: req.method,
    path: req.url,
    contentType: req.headers['content-type'] || '',
    apiKey: req.headers['x-api-key'],
    overwrite: req.headers.overwrite,
    printAfterUpload: req.headers['print-after-upload'],
    filename,
    fields: {
      select: field('select'),
      print: field('print'),
      root: field('root'),
    },
    bytes: body.length,
  };
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');
  return entry;
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const url = (req.url || '').split('?')[0];

    // connection checks: `testPrinter` reads these two
    if (req.method === 'GET' && url === '/api/version') return json(res, 200, { api: '0.1', server: '1.0-mock', text: 'mock print host' });
    if (req.method === 'GET' && url === '/server/info')
      return json(res, 200, { result: { klipper_path: '/opt/klipper', python_path: '/usr/bin/python3', state: 'ready' } });
    // the log over HTTP, for a manual look: the suite reads the mounted file instead
    if (req.method === 'GET' && url === '/uploads') {
      let raw = '';
      try {
        raw = fs.readFileSync(LOG, 'utf8');
      } catch {
        /* nothing uploaded yet */
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(raw);
    }

    if (req.method === 'POST' && url === '/api/files/local') return json(res, 201, { done: true, ...record(req, body) });
    if (req.method === 'POST' && url === '/server/files/upload')
      return json(res, 201, { result: { item: { path: 'gcodes/x.gcode' }, action: 'create_file', ...record(req, body) } });
    if (req.method === 'PUT' && url.startsWith('/api/v1/files/')) return json(res, 201, { ok: true, ...record(req, body) });

    json(res, 404, { error: `mock print host: ${req.method} ${url} is not part of it` });
  });
});

server.listen(PORT, '0.0.0.0', () => console.log(`[mock-host] listening on :${PORT}, logging to ${LOG}`));
