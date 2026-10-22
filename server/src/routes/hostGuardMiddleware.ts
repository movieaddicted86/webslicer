/**
 * The Host / Origin guard as Express middleware (SEC-2, S1).
 *
 * The rules live in `services/hostGuard.ts`; this is the thin shell that answers 403. It sits in
 * `app.ts` around `/api` and `/mcp` – before any body parser and before the auth of the MCP router,
 * so a rebound page is refused whatever the request carries.
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { allowedHostNames, hostAllowed, originAllowed } from '../services/hostGuard.js';

/** Refuse a request whose `Host` (or browser `Origin`) is not an address this server answers on. */
export function hostGuard() {
  const allowed = allowedHostNames(config.allowedHosts);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!hostAllowed(req.header('host'), allowed)) {
      res.status(403).json({ error: 'host not allowed' });
      return;
    }
    if (!originAllowed(req.header('origin'), allowed)) {
      res.status(403).json({ error: 'origin not allowed' });
      return;
    }
    next();
  };
}
