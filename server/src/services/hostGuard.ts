/**
 * The Host / Origin allowlist against DNS rebinding.
 *
 * The server listens on `0.0.0.0`, so an internet page can reach the whole API at the LAN address
 * through a rebound name. A request is refused when its `Host` names an address the server does not
 * answer on: `localhost`/loopback, any IP literal (installs opened by LAN IP must keep working), the
 * machine's own addresses and `ALLOWED_HOSTS` pass. An `Origin`, sent by browsers only, has to be
 * same-origin, loopback, an own address or an `ALLOWED_HOSTS` name. Pure: lists in, verdict out, and
 * the same verdict drives `/api` and `/mcp`.
 */
import os from 'node:os';
import { isIP } from 'node:net';

/** The `Host` of a request without its port: `[::1]:8080` → `[::1]`, `nas:8080` → `nas`. */
export function hostNameOf(hostHeader: string | undefined): string | undefined {
  const host = String(hostHeader ?? '')
    .trim()
    .toLowerCase();
  if (!host) return undefined;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    // an unmatched `[` is not a host at all
    return end < 0 ? undefined : host.slice(0, end + 1);
  }
  // a bare IPv6 address has more than one colon and no port after it
  if (host.split(':').length > 2) return host;
  const colon = host.indexOf(':');
  return colon < 0 ? host : host.slice(0, colon);
}

/** How long a refused header value may be when it is echoed back in a hint. */
const ECHO_MAX = 100;

/**
 * A `Host`/`Origin` header as it may be echoed back to the client: trimmed, printable ASCII only and
 * cut to 100 characters. The header is attacker-controlled, so it goes into a JSON `hint` and a log
 * line, never into HTML; an empty result is named `(unknown)`.
 */
export function printableHeader(value: string | undefined): string {
  const cleaned = [...String(value ?? '').trim()]
    // the printable ASCII range: control characters (and the escape sequences built from them) are gone
    .filter((c) => c >= ' ' && c <= '~')
    .join('')
    .slice(0, ECHO_MAX);
  return cleaned || '(unknown)';
}

const LOOPBACK_NAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Whether a bare host name is a loopback name (with or without brackets). */
export function isLoopbackName(name: string): boolean {
  return LOOPBACK_NAMES.has(name);
}

/** Whether a host name is an IP literal (`192.168.1.5`, `[fe80::1]`) – always allowed. */
export function isIpLiteral(name: string): boolean {
  const bare = name.startsWith('[') && name.endsWith(']') ? name.slice(1, -1) : name;
  return isIP(bare) !== 0;
}

/**
 * The addresses of this machine's network interfaces, in the forms a `Host` can have them:
 * `192.168.1.5` as it is, and `[fe80::1]` for an IPv6 address.
 */
export function localAddresses(): string[] {
  const addrs: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      const address = a.address.toLowerCase();
      // a zone index (`fe80::1%eth0`) is not part of the address a client sends
      const bare = address.split('%')[0];
      addrs.push(address.includes(':') ? `[${bare}]` : bare);
    }
  }
  return addrs;
}

/** The names a request may name in `Host`/`Origin`: loopback, this machine's addresses, `ALLOWED_HOSTS`. */
export function allowedHostNames(extra: readonly string[], local: readonly string[] = localAddresses()): Set<string> {
  const set = new Set<string>();
  for (const name of [...LOOPBACK_NAMES, ...local, ...extra]) {
    const host = hostNameOf(name) ?? name;
    if (host) set.add(host);
  }
  return set;
}

/** Whether the `Host` of a request is allowed. */
export function hostAllowed(hostHeader: string | undefined, allowed: ReadonlySet<string>): boolean {
  const name = hostNameOf(hostHeader);
  if (!name) return false;
  return allowed.has(name) || isIpLiteral(name);
}

/**
 * The port a `Host` header names, or `undefined` when it carries none.
 *
 * `[::1]:8080` → `8080`; a bare `fe80::1` has no port (its colons belong to the address).
 */
function hostPortOf(hostHeader: string | undefined): string | undefined {
  const host = String(hostHeader ?? '')
    .trim()
    .toLowerCase();
  if (!host) return undefined;
  if (!host.startsWith('[') && host.split(':').length > 2) return undefined;
  const colon = host.startsWith('[') ? host.indexOf(':', host.indexOf(']')) : host.indexOf(':');
  return colon < 0 ? undefined : host.slice(colon + 1) || undefined;
}

/** The port an origin URL means, including the scheme's default. */
function originPortOf(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

/**
 * Whether an `Origin` header (absolute, or `null` from a sandboxed page) is one this install trusts.
 *
 * Unlike `Host`, an arbitrary **IP literal is not accepted**: the pin is `Host: 192.168.1.42:8080` +
 * `Origin: http://203.0.113.5` → 403. An origin passes when it is
 *
 * - same-origin with the request – the name and port equal the `Host` header (a browser page served
 *   by this server), or
 * - a name in `allowed`: loopback, one of this machine's own interface addresses, or an
 *   `ALLOWED_HOSTS` name. Those are trusted on any port – the Vite dev server and a reverse proxy in
 *   front of the app run on another port by design.
 *
 * Any other IP literal is refused: `Origin: http://203.0.113.5` never passes, whatever the `Host` is.
 */
export function originAllowed(originHeader: string | undefined, hostHeader: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!originHeader) return true;
  if (originHeader === 'null') return false;
  let url: URL;
  try {
    url = new URL(originHeader);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const name = hostNameOf(url.host);
  if (!name) return false;
  if (allowed.has(name)) return true;
  if (name !== hostNameOf(hostHeader)) return false;
  const requestPort = hostPortOf(hostHeader);
  const originPort = originPortOf(url);
  // a `Host` without a port names a scheme default – the header has no scheme, so both count
  // (80 direct, 443 behind a TLS reverse proxy that forwards the Host unchanged)
  return requestPort === undefined ? originPort === '80' || originPort === '443' : requestPort === originPort;
}
