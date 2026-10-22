/**
 * MCP bearer tokens (`docs/MCP-Concept.md` §5).
 *
 * A token is never stored in clear text: `data/mcp-tokens.json` holds a SHA-256 of the token
 * (`sha256$<hex>`) together with the owner the token acts as. SHA-256 is enough because a token is
 * 32 random bytes (not a guessable password), and unlike scrypt it costs microseconds – a junk
 * header must not stall the event loop (S9). Entries written by older versions carry a scrypt hash
 * (`scrypt$<salt>$<hash>`); they keep working and are replaced by the SHA-256 on the first
 * successful authentication.
 *
 * The environment variable `MCP_TOKEN` is bootstrapped into that list on start (owner `admin`); as
 * long as no token exists, `/mcp` answers 404, and removing `MCP_TOKEN` removes the bootstrapped
 * entry again, so the endpoint is really off and no credential stays behind.
 */
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { readJsonSync, writeJsonSync } from '../services/jsonStore.js';

export interface McpToken {
  id: string;
  name: string;
  /** projects created with this token belong to this owner */
  owner: string;
  /** `sha256$<hex>` (current) or `scrypt$<salt>$<hash>` (written before S9) */
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
}

/** id of the entry that mirrors `MCP_TOKEN` (kept in sync with the environment on every start) */
export const ENV_TOKEN_ID = 'env-mcp-token';

const KEYLEN = 64;
/** cost of the legacy scrypt hash; only used to verify and migrate old entries */
const SCRYPT = { N: 16384, r: 8, p: 1 };
/** `lastUsedAt` is written at most this often, so a busy client does not rewrite the file per call */
const TOUCH_INTERVAL_MS = 60_000;

/** The stored form of a token: `sha256$<hex>` (S9). */
export function hashToken(token: string): string {
  return `sha256$${createHash('sha256').update(token, 'utf8').digest('hex')}`;
}

/** Constant-time comparison of a presented token against the current SHA-256 record. */
function verifySha256(token: string, hex: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(hex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== 32) return false;
  const actual = createHash('sha256').update(token, 'utf8').digest();
  return timingSafeEqual(actual, expected);
}

/** The legacy scrypt check, kept so existing token files keep working until they are migrated. */
function verifyScrypt(token: string, salt: string, hex: string): boolean {
  let expected: Buffer;
  try {
    expected = Buffer.from(hex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;
  return timingSafeEqual(scryptSync(token, salt, KEYLEN, SCRYPT), expected);
}

/**
 * Constant-time comparison of a presented token against a stored record. Handles both the current
 * `sha256$…` form and the legacy `scrypt$…` form; anything malformed is simply false.
 */
export function verifyTokenHash(token: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (!token || parts.length < 2) return false;
  if (parts[0] === 'sha256' && parts.length === 2 && parts[1]) return verifySha256(token, parts[1]);
  if (parts[0] === 'scrypt' && parts.length === 3 && parts[1] && parts[2]) return verifyScrypt(token, parts[1], parts[2]);
  return false;
}

/** Whether a stored record still uses the slow legacy form and should be migrated (S9). */
function isLegacyHash(stored: string): boolean {
  return String(stored || '').startsWith('scrypt$');
}

function isToken(v: unknown): v is McpToken {
  const t = v as McpToken;
  return !!t && typeof t.id === 'string' && typeof t.owner === 'string' && typeof t.hash === 'string';
}

export function loadTokens(): McpToken[] {
  // B7: a corrupt token file is quarantined and logged; answering "no tokens" used to let the next
  // bootstrap write overwrite the only copy
  const { value: list } = readJsonSync<unknown>(config.mcpTokensFile);
  return Array.isArray(list) ? list.filter(isToken) : [];
}

export function saveTokens(list: McpToken[]): void {
  // B7: temp + rename, still created with mode 0600 (no window in which the file is world-readable)
  writeJsonSync(config.mcpTokensFile, list, 0o600);
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
  // the stored hash already belongs to this value, so compare by verifying (and upgrade a legacy
  // scrypt entry to the cheap SHA-256 while we are here, S9)
  if (value && previous && verifyTokenHash(value, previous.hash)) {
    if (isLegacyHash(previous.hash)) {
      previous.hash = hashToken(value);
      saveTokens(stored);
    }
    return stored.length;
  }
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
 * not depend on which entry matches. A legacy scrypt entry that authenticates is rewritten as a
 * SHA-256 record (S9), so the slow check runs at most once per token.
 */
export function authenticate(presented: string): McpToken | undefined {
  if (!presented) return undefined;
  let found: McpToken | undefined;
  for (const t of loadTokens()) {
    if (verifyTokenHash(presented, t.hash) && !found) found = t;
  }
  if (found) {
    if (isLegacyHash(found.hash)) migrateToken(found.id, presented);
    touchToken(found.id);
  }
  return found;
}

/** Replace a legacy scrypt record with the SHA-256 of the token that just proved itself. */
function migrateToken(id: string, presented: string): void {
  const list = loadTokens();
  const token = list.find((t) => t.id === id);
  if (!token || !isLegacyHash(token.hash)) return;
  token.hash = hashToken(presented);
  try {
    saveTokens(list);
  } catch {
    /* a read-only token file keeps the legacy record; the token still works */
  }
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
