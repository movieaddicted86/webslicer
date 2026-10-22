/**
 * The Host / Origin allowlist (SEC-2, S1 – DNS rebinding).
 *
 * The server listens on `0.0.0.0`, so every device in the LAN can reach it by IP; that is the point
 * of the app. A browser on a page from the internet reaches it too: DNS rebinding loads
 * `http://attacker.example/<thing>` (the name resolves to the LAN address) and the script then sends
 * same-origin requests to the whole API – no preflight, no CORS, and the MCP `Origin == Host` check
 * passed because both were the attacker's own rebound name.
 *
 * The guard is the one every local tool with an API uses: a request whose `Host` names an address the
 * server does not answer on is refused. Allowed are
 *
 * - `localhost` and the loopback addresses (any port, IPv4 and IPv6),
 * - any **IP address** – a DNS rebinding attack needs a name the attacker controls, and an IP literal
 *   cannot be one. Without this an install opened by LAN IP (and a Docker port mapping, where the
 *   container sees the host's LAN IP in `Host`, not its own bridge address) would break,
 * - the interface addresses of this machine (an install opened by its own LAN name/IP),
 * - and whatever `ALLOWED_HOSTS` lists (NAS/LXC host names, a reverse-proxy name).
 *
 * A request with an `Origin` header must have an allowed origin too. Only browsers send one, and only
 * for a cross-origin or a state-changing request; an MCP client (Claude Desktop, Claude Code, Home
 * Assistant) sends none and passes, exactly as before.
 *
 * Pure: address lists in, a verdict out – the rules are unit-tested without a socket, and the same
 * verdict drives `/api` and `/mcp`.
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

/** Whether an `Origin` header (absolute, or `null` from a sandboxed page) names an allowed host. */
export function originAllowed(originHeader: string | undefined, allowed: ReadonlySet<string>): boolean {
  if (!originHeader) return true;
  if (originHeader === 'null') return false;
  try {
    const name = hostNameOf(new URL(originHeader).host);
    return !!name && (allowed.has(name) || isIpLiteral(name));
  } catch {
    return false;
  }
}
