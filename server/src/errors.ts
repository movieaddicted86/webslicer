/**
 * Typed errors of the server core (N-5).
 *
 * The services and the pure modules throw these; the single error handler in `app.ts` maps them to
 * HTTP status codes. Before this module the status was smuggled onto a plain `Error` with
 * `Object.assign(new Error(…), { status })`, which no type checker could see and which the MCP layer
 * had to guess at.
 */

/** An error with an HTTP status; `ValidationError` and `NotFoundError` are the usual cases. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** Bad input from the client (400). */
export class ValidationError extends HttpError {
  constructor(message: string) {
    super(400, message);
  }
}

/** The addressed resource does not exist (404). */
export class NotFoundError extends HttpError {
  constructor(message: string) {
    super(404, message);
  }
}

/** The addressed resource exists but cannot be used in its current state (409). */
export class ConflictError extends HttpError {
  constructor(message: string) {
    super(409, message);
  }
}

/** The HTTP status of a thrown value, if it carries one. */
export function statusOf(error: unknown): number | undefined {
  return error instanceof HttpError ? error.status : undefined;
}
