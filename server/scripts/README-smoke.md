# `api-smoke.ts` – behaviour diff for the REST API

`api-smoke.ts` calls every REST endpoint of `server/src/routes/api.ts`, `library.ts` and `projects.ts` on
a **running** server and writes one canonical JSON snapshot of all responses. Running it against two
servers and diffing the two snapshots answers the question a refactoring has to answer: did anything
observable change?

The script needs no build step and no dependencies beyond Node 22 (`fetch`, `node:` builtins).

```bash
npx tsx server/scripts/api-smoke.ts
```

## Environment

| Variable            | Meaning                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMOKE_URL`         | base URL of the server under test, default `http://localhost:8080`                                                                                                                                                                           |
| `SMOKE_DATA_DIR`    | host path mounted as `/data`; the script writes `installed_printers.json` and `physical_printers.json` there so both servers start from the same state. Unset: the snapshot reports `"skipped"` for that step and may contain foreign state. |
| `SMOKE_LIBRARY_DIR` | host path mounted as `/library`; used to seed a file directly and to check that an upload really lands on the mount. Unset: those checks report `"skipped"`.                                                                                 |
| `SMOKE_OUT`         | file to write the snapshot to, default: stdout                                                                                                                                                                                               |

Progress goes to **stderr**, so stdout stays a clean JSON document. The script exits `0` even when single
requests fail (a failure is part of the snapshot) and `2` only when the server does not answer at all.

## Comparing two builds

Build the image once and start one container per branch, each with its own data and library directory –
sharing them would make the two snapshots depend on each other.

```bash
docker build -t webslicer:candidate .

# container A: the reference build (e.g. main)
docker run -d --name smoke-a -p 8081:8080 \
  -v "$PWD/.smoke/a/data:/data" -v "$PWD/.smoke/a/library:/library" webslicer:candidate

# container B: the refactoring branch
docker run -d --name smoke-b -p 8082:8080 \
  -v "$PWD/.smoke/b/data:/data" -v "$PWD/.smoke/b/library:/library" webslicer:candidate
```

`/data` holds settings, installed printers, uploaded models, jobs and autosaves; `/library` is the
mounted file library. Both directories are created by Docker on first start, and the library is **seeded
with the bundled samples on first start** as long as it is still empty – the script relies on
`samples/calibration_cube_20mm.stl` being listed. The 3MF for the project-import check is not a sample:
the script writes it through `/api/export/3mf` and stores it in the library itself. `samples/` itself
is copied into the image at `/app/samples` by the `Dockerfile` and is served through `/api/library/file`.

The first start also reads the PrusaSlicer vendor bundles, so give the containers a few seconds before
the first run. Wait for both to answer:

```bash
curl -fsS http://localhost:8081/api/health && curl -fsS http://localhost:8082/api/health
```

Then run the harness against each – a fresh server state and the same script on both sides:

```bash
SMOKE_URL=http://localhost:8080 SMOKE_DATA_DIR="$PWD/.smoke/a/data" SMOKE_LIBRARY_DIR="$PWD/.smoke/a/library" \
  SMOKE_OUT=smoke-a.json npx tsx server/scripts/api-smoke.ts

SMOKE_URL=http://localhost:8080 SMOKE_DATA_DIR="$PWD/.smoke/b/data" SMOKE_LIBRARY_DIR="$PWD/.smoke/b/library" \
  SMOKE_OUT=smoke-b.json npx tsx server/scripts/api-smoke.ts

diff -u smoke-a.json smoke-b.json
```

`SMOKE_URL` is only the address the script talks to; the two host directories are what make the runs
comparable. Point them at the directories of the container whose port is in `SMOKE_URL`.

## What the snapshot contains

`{ url, note, setup, endpoints: [...] }`, keys sorted, ids and timestamps normalised:

- every request with `key` (method + path, ids replaced by `<uuid>`), `method`, `path`, `status`, the
  `content-type` / `content-disposition` / `cache-control` headers when present, and the response body;
- the SSE stream of a running job as `events` (the sequence of event `type` values) plus `framing` (the
  first 40 characters of the wire format) and the `content-type` / `cache-control` headers;
- `POST /api/export/3mf` and `POST /api/library/project` as the SHA-256 of `3D/3dmodel.model`; the ZIP
  container around it carries timestamps and would differ in every run;
- `POST /api/export/config` as the list of generated configuration lines – deterministic, and a changed
  merge order shows up there immediately;
- the G-code output as status and headers only; the file itself is large and machine generated.

Normalised (`<uuid>`, `<ts>` or `<n>`): UUIDs, ISO timestamps, `size`/`sizeBytes`, `percent`, `layers`,
`maxZ`, any `*At` field, `filamentUsed*`, `estimatedTime*`, library mtimes and printer connection error
texts. Everything else – status codes, error messages, `ok` flags, preset names, counts, enum values and
the generated configuration – is compared verbatim.

Two runs of the same script against the same server must produce identical output; a non-empty `diff` of
two _different_ servers is the finding.

## Covered routes

`GET /api/health`, `/api/info`, `/api/schema`, `/api/vendors`, `/api/vendors/:vendor/asset/:file`,
`/api/installed-printers` (GET/PUT), `/api/presets/:type/list`, `/api/presets/:type/default`,
`/api/presets/:type/:name` (GET/PUT/DELETE), `/api/models` (POST), `/api/models/:id` (GET/DELETE),
`/api/export/3mf`, `/api/export/config`, `/api/slice`, `/api/jobs`, `/api/jobs/:id`,
`/api/jobs/:id/events`, `/api/jobs/:id/gcode`, `/api/jobs/:id/log`, `/api/jobs/:id/cancel`,
`/api/jobs/:id/send`, `/api/jobs/:id` (DELETE), `/api/printers` (GET/POST), `/api/printers/:id`
(PUT/DELETE), `/api/printers/:id/test`, `/api/printers/test`, `/api/library`, `/api/library/file`
(GET/PUT/DELETE), `/api/library/mkdir`, `/api/library/project`, `/api/library/gcode`,
`/api/autosave/:client` (GET/PUT/DELETE), `/api/projects/parse`, `/api/projects` (POST),
`/api/projects/:id`, `/api/projects/:id/models`, `/api/projects/:id/arrange`, `/api/projects/:id/slice`.

Each route is called on its happy path where that is cheap and with the error inputs it guards against:
empty body, missing and unknown id, path escape, invalid client id, an oversized upload (413) and an
over-`maxUploadBytes` stream.

## Side effects

The script is written to be run against a throwaway container, and it cleans up after itself: the
presets, models, jobs and autosaves it creates are deleted again, and the library files it writes are
removed. It does write to the two data files named above when `SMOKE_DATA_DIR` is set, replaces the list
of physical printers and leaves a few temporary jobs in `/data/jobs` when a step fails midway.
