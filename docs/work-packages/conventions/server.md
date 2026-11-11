# Server specifics

Part of [CONVENTIONS.md](../CONVENTIONS.md) §4.

- Every request body is validated against the schema of its payload in `server/src/validation/`
  before use (types, lengths, limits) – the same schema the MCP tools declare to their clients.
  Reject invalid input with a clear message; never trust the client.
- Types shared with the web app live in `shared/src/types` and are declared **once** there.
  `web/src/api.ts` re-exports them, so `import { type SliceRequest } from './api'` keeps working;
  nothing is declared a second time on the web side.
- 3MF output must stay loadable by **desktop PrusaSlicer** and must roundtrip through
  `read3mfProject`. Any change to `threemf/` needs a roundtrip test.
