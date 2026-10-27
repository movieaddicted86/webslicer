/**
 * The Host / Origin guard as Express middleware (SEC-2, S1).
 *
 * The rules live in `services/hostGuard.ts`; this is the thin shell that answers 403. It sits in
 * `app.ts` around `/api` and `/mcp` – before any body parser and before the auth of the MCP router,
 * so a rebound page is refused whatever the request carries.
 *
 * A refusal also says what was refused and how to fix it: the body keeps its `error` (clients and
 * tests rely on it) and gains a `hint` naming the header value and the one setting that opens it.
 * A user who opened the app by a name the server does not know otherwise sees a dead page and has to
 * find `ALLOWED_HOSTS` in the docs.
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { allowedHostNames, hostAllowed, hostNameOf, originAllowed, printableHeader } from '../services/hostGuard.js';

type Refusal = 'host' | 'origin';

/** How long the same refused value stays quiet in the log: one warn line per value per hour. */
const LOG_INTERVAL_MS = 60 * 60 * 1000;

/** At most this many distinct refused values are remembered; a flood starts the rate limit afresh. */
const LOG_KEYS_MAX = 500;

/** When each refused value was last logged. Module state, like the guard's own allowlist cache. */
const lastLogged = new Map<string, number>();

/**
 * The hint of a refusal: the value the server was asked for (sanitised – it is attacker-controlled)
 * and the two ways out, in the wording of the setting that fixes each install.
 */
export function refusalHint(kind: Refusal, value: string | undefined): string {
  const what = kind === 'host' ? 'name' : 'origin';
  return (
    `This server does not answer to the ${what} "${printableHeader(value)}". ` +
    'Add it to ALLOWED_HOSTS (Docker/Unraid: environment variable; ' +
    'Proxmox: /etc/webslicer/webslicer.env, then systemctl restart webslicer) or open the app by its IP address.'
  );
}

/**
 * Whether this refused value gets a log line now (true once per hour and value), so a misconfigured
 * proxy or a rebound page that keeps knocking cannot flood the log.
 */
export function refuseToLog(kind: Refusal, value: string | undefined, now = Date.now()): boolean {
  const name = printableHeader(value);
  // a `Host` is remembered by its name (`nas:8080` and `nas` are the same refusal), an `Origin` whole
  const key = kind === 'host' ? `host:${hostNameOf(name) ?? name}` : `origin:${name}`;
  const last = lastLogged.get(key);
  if (last !== undefined && now - last < LOG_INTERVAL_MS) return false;
  if (lastLogged.size >= LOG_KEYS_MAX && !lastLogged.has(key)) lastLogged.clear();
  lastLogged.set(key, now);
  return true;
}

/** Forget the log history (a test proves one value logs once and another value logs on its own). */
export function resetRefusalLog(): void {
  lastLogged.clear();
}

/** Refuse a request whose `Host` (or browser `Origin`) is not an address this server answers on. */
export function hostGuard() {
  const allowed = allowedHostNames(config.allowedHosts);
  return (req: Request, res: Response, next: NextFunction): void => {
    const host = req.header('host');
    if (!hostAllowed(host, allowed)) {
      refuse('host', host);
      res.status(403).json({ error: 'host not allowed', hint: refusalHint('host', host) });
      return;
    }
    const origin = req.header('origin');
    if (!originAllowed(origin, host, allowed)) {
      refuse('origin', origin);
      res.status(403).json({ error: 'origin not allowed', hint: refusalHint('origin', origin) });
      return;
    }
    next();
  };
}

/** The log side of a refusal: the sanitised value only, never the full header at info level. */
function refuse(kind: Refusal, value: string | undefined): void {
  if (!refuseToLog(kind, value)) return;
  console.warn(`[webslicer] refused ${kind} "${printableHeader(value)}" – add it to ALLOWED_HOSTS if it is yours`);
}
