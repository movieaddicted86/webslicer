/**
 * MCP bearer tokens (`docs/MCP-Concept.md` §5).
 *
 * A token is never stored in clear text: `data/mcp-tokens.json` holds a scrypt hash
 * (`scrypt$<salt>$<hash>`) together with the owner the token acts as. The environment variable
 * `MCP_TOKEN` is bootstrapped into that list on start (owner `admin`); as long as no token exists,
 * `/mcp` answers 404, and removing `MCP_TOKEN` removes the bootstrapped entry again, so the
 * endpoint is really off and no credential stays behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface McpToken {
  id: string;
  name: string;
  /** projects created with this token belong to this owner */
  owner: string;
  /** `scrypt$<salt>$<hash>` */
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** id of the entry that mirrors `MCP_TOKEN` (kept in sync with the environment on every start) */
export const ENV_TOKEN_ID = 'env-mcp-token';

const KEYLEN = 64;
/** cost of the hash; the scrypt defaults (N=16384, r=8, p=1) fit into Node's 32 MB maxmem */
const SCRYPT = { N: 16384, r: 8, p: 1 };
/** `lastUsedAt` is written at most this often, so a busy client does not rewrite the file per call */
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string, salt = randomBytes(16).toString('hex')): string {
  const key = scryptSync(token, salt, KEYLEN, SCRYPT);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyTokenHash(token: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[2], 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  return timingSafeEqual(scryptSync(token, parts[1], KEYLEN, SCRYPT), expected);
}

function isToken(v: unknown): v is McpToken {
  const t = v as McpToken;
  return !!t && typeof t.id === 'string' && typeof t.owner === 'string' && typeof t.hash === 'string';
}

export function loadTokens(): McpToken[] {
  try {
    const list = JSON.parse(fs.readFileSync(config.mcpTokensFile, 'utf8')) as unknown;
    return Array.isArray(list) ? list.filter(isToken) : [];
  } catch {
    return [];
  }
}

export function saveTokens(list: McpToken[]): void {
  fs.mkdirSync(path.dirname(config.mcpTokensFile), { recursive: true });
  fs.writeFileSync(config.mcpTokensFile, JSON.stringify(list, null, 2), { mode: 0o600 });
}

/** Is the MCP endpoint configured at all? Without any token it does not exist (404). */
export function mcpEnabled(): boolean {
  return loadTokens().length > 0;
}

/**
 * Keep the entry that mirrors `MCP_TOKEN` in sync with the environment: it is added or updated when
 * the variable is set, and removed when it is not – so turning the variable off turns the endpoint
 * off. Returns the number of configured tokens.
 */
export function bootstrapEnvToken(env = process.env.MCP_TOKEN): number {
  const value = (env || '').trim();
  const stored = loadTokens();
  const others = stored.filter((t) => t.id !== ENV_TOKEN_ID);
  const previous = stored.find((t) => t.id === ENV_TOKEN_ID);
  // the stored hash already belongs to this value (a fresh salt per call, so compare by verifying)
  if (value && previous && verifyTokenHash(value, previous.hash)) return stored.length;
  if (!value) {
    if (!previous) return others.length;
    saveTokens(others); // the variable is gone, so the credential it created goes too
    return others.length;
  }
  const list: McpToken[] = [
    {
      id: ENV_TOKEN_ID,
      name: 'MCP_TOKEN (environment)',
      owner: 'admin',
      hash: hashToken(value),
      createdAt: previous?.createdAt || new Date().toISOString(),
      lastUsedAt: previous?.lastUsedAt,
    },
    ...others,
  ];
  saveTokens(list);
  return list.length;
}

/**
 * Authenticate a presented token. Every stored entry is checked (no early exit), so the work does
 * not depend on which entry matches.
 */
export function authenticate(presented: string): McpToken | undefined {
  if (!presented) return undefined;
  let found: McpToken | undefined;
  for (const t of loadTokens()) {
    if (verifyTokenHash(presented, t.hash) && !found) found = t;
  }
  if (found) touchToken(found.id);
  return found;
}

/** Authenticate an `Authorization` header value (`Bearer <token>`). */
export function authenticateHeader(header: string | undefined): McpToken | undefined {
  const m = /^Bearer[ \t]+(.+)$/i.exec(String(header || '').trim());
  return m ? authenticate(m[1].trim()) : undefined;
}

/** Record the last use of a token (throttled: at most one write per minute and token). */
function touchToken(id: string): void {
  const list = loadTokens();
  const token = list.find((t) => t.id === id);
  if (!token) return;
  const last = token.lastUsedAt ? Date.parse(token.lastUsedAt) : 0;
  if (Number.isFinite(last) && Date.now() - last < TOUCH_INTERVAL_MS) return;
  token.lastUsedAt = new Date().toISOString();
  try {
    saveTokens(list);
  } catch {
    /* a read-only token file must not break a request */
  }
}
