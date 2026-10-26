/**
 * Server meta endpoints: `/api/info` and the library browser (R-2, F-08).
 */

export interface ServerInfo {
  version: string;
  slicerVersion: string;
  slicerBin: string;
  resourcesDir?: string;
  vendors: number;
  maxJobs: number;
  maxUploadBytes: number;
}

/** One row of the library listing (`/api/library`). */
export interface LibraryEntry {
  name: string;
  path: string;
  dir: boolean;
  size?: number;
  mtime?: string;
  kind?: 'model' | 'project' | 'gcode' | 'other';
}

/**
 * The one-time risk notice (T-085, AC-4): whether the user has acknowledged `RISK_NOTICE_SHORT`, and
 * for which app version. Stored server-side, so it survives a reload and a new browser; the card is
 * shown again only after a **major** version change (`1.x` → `2.0`), never twice per major version.
 */
export interface RiskNoticeStatus {
  acknowledged: boolean;
  /** the app version the acknowledgement was given for (e.g. `1.0.0-rc.5`) */
  version?: string;
  /** when the acknowledgement was stored, ISO */
  acknowledgedAt?: string;
}
