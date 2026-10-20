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
