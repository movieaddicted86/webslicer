/**
 * The update notice (T-058, Robert): whether the GitHub repository of WebSlicer has moved on since
 * the build that is running.
 *
 * The check runs on the **server** and its answer is this one object. The browser only reads it, so
 * the two sides cannot disagree about what "behind" means.
 */

/** One answer of `GET /api/update-status`. */
export interface UpdateStatus {
  /** the commit the running build was made from; `unknown` when the build did not know it */
  current: string;
  /** the head of the tracked branch the last check saw (the running commit when nothing is known) */
  latest: string;
  /** commits the tracked branch is ahead of `current`; 0 when up to date or not comparable */
  behind: number;
  /** where the user reads what is new: the release page of the newer tag, else the comparison */
  url: string;
  /** when the last successful check ran (ISO 8601), `null` before the first one */
  checkedAt: string | null;
  /** `false` when the check is switched off (`WEBSLICER_UPDATE_CHECK=off`): nothing is requested */
  enabled: boolean;
  /** the newest release tag, only when it is newer than the running version */
  tag?: string;
}
