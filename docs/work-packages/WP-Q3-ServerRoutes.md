# Work package Q3 – Split the API router, typed contract

|            |                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q3-server-routes` (branch `feature/q3-server-routes`)                                                                                                                                                                                                                 |
| Findings   | W1, A4, A5 (server), W3 (rest), W4 (server rest)                                                                                                                                                                                                                       |
| Base       | `main` after `q2-slicer-cli` is merged                                                                                                                                                                                                                                 |
| Read first | CONVENTIONS.md, CODING-GUIDELINES.md, this file                                                                                                                                                                                                                        |
| Estimate   | 4 phases, one commit each                                                                                                                                                                                                                                              |
| Allowed    | `server/src/routes/**`, `server/src/services/**`, `server/src/validation/**`, `server/src/slicer/presets.ts`, `server/src/app.ts`, new `server/src/storage/`, `eslint.config.mjs`, import-path updates in any server file after moving `jsonStore`, tests next to them |

## 1. Goal

Routes only validate, call one service and answer (the rule CONVENTIONS §1 already states).
`routes/api.ts` (21.9 KB at `eb00fa4`, +25 % in one day) is split into one router per resource,
the logic it holds moves into services, and the request/response contract is checked by the
compiler so the zod schemas and the `shared` types cannot drift apart.

## 2. Acceptance criteria

- AC-1 `routes/api.ts` is reduced to mounting sub-routers (target < 3 KB). New files, one per
  resource: `presets.ts`; `models.ts` (upload, GET/DELETE `/models/:id`, STEP convert, cut);
  `jobs.ts` (slice, jobs list, cancel, delete, events SSE, gcode, log, send); `printers.ts`;
  `exports.ts` (3mf, config); `autosave.ts`; `meta.ts` (health, info, schema, vendors,
  `/vendors/:vendor/asset/:file`, installed-printers). `/projects/parse` goes to `exports.ts` or
  `projects.ts` and stays mounted **before** `projectsRouter` (route order matters). Every route
  that exists at the base exists afterwards – Phase 0 lists them all, Phase 1 checks the list.
  `library.ts` and `projects.ts` stay.
- AC-2 No file in `server/src/routes/` imports `../slicer/**` or `../jobs*`. (Imports of
  `services/*`, `validation/*`, `errors`, `config`, `./uploads` and `@webslicer/shared` are fine.)
  Enforced with an ESLint `no-restricted-imports` override for `server/src/routes/**`.
- AC-3 Every schema in `server/src/validation/` that parses a request with a type in
  `shared/src/types` is declared with `satisfies z.ZodType<ThatType>` (or the shared type is
  replaced by `z.infer` of the schema if the type is server-only). No `req.body as …` casts remain
  in routes.
- AC-4 Each route's success body is typed: `res.json(body satisfies ServerInfo)` or a typed helper
  `sendJson<T>(res, body: T)`.
- AC-5 Dependency direction in services: `slicer/presets.ts` no longer imports
  `services/jsonStore` (move `jsonStore` to a neutral `server/src/storage/` or into `slicer/`
  callers via a parameter); the `services/projects` ↔ `validation/projects` type cycle is gone.
- AC-6 Duplicate helpers removed: `maskPrinter` uses `API_KEY_MASK`; no `const schemaOf = activeSchema`
  aliases; no second `PRESET_TYPES`.
- AC-7 Behaviour unchanged: `npm test` (incl. `routes/http.test.ts`), `npm run e2e:docker`, and
  `server/scripts/api-smoke.ts` against a running server produce the same results as on the base.

## 3. Binding decisions

- Split by moving code, not rewriting it. Function bodies move unchanged unless a phase says so.
- The SSE implementation moves into `services/jobEvents.ts` (or next to `jobs.ts`), the route only
  wires `req`/`res` to it.
- Cut and STEP orchestration (temp files, `parseStl`, `saveModel`) moves into
  `services/models.ts`; `routes/models.ts` keeps only upload streaming, validation and response.
- No codegen, no OpenAPI, no API versioning.

## 4. Phases

### Phase 0 – Baseline

- Run AC-7 commands, save the `api-smoke.ts` output. Record byte sizes of all files in
  `server/src/routes/` and `services/`. List every route (method + path) mounted under `/api`
  at the base. No commit.

### Phase 1 – Router split (pure move)

- Create the resource routers (AC-1), `api.ts` mounts them in the old order (middleware order
  matters for the host guard and body parsers).
- Check: AC-7. Commit: `Server: one router per resource (q3-server-routes)`

### Phase 2 – Logic into services, import rule

- Move preset key filtering, API-key mask merging, SSE, cut/STEP orchestration, autosave 3MF
  building into services. Add the `no-restricted-imports` override (AC-2). Fix AC-5 and AC-6.
- Check: AC-7, `npm run lint`. Commit: `Server: routes call services only (q3-server-routes)`

### Phase 3 – Typed contract

- AC-3 and AC-4. Where a schema and its shared type disagree, the compiler error is the finding:
  list each one in the handover with the decision taken (fix schema or fix type), do not paper over
  it with casts.
- Check: AC-7, `npm run typecheck`. Commit: `Server: schemas and responses checked against shared types (q3-server-routes)`

### Phase 4 – Docs and handover

- Update CONVENTIONS §1 file map (routes folder, no `threemf.ts` single file). CHANGELOG bullet.
- Handover: sizes before/after, list of schema/type mismatches found in Phase 3.
- Commit: `Docs: server routes layout (q3-server-routes)`

## 5. Pitfalls

- `express.raw` / streaming upload middleware is route-specific; keep it on exactly the same paths.
- The host guard is mounted on `/api` in `app.ts`; the sub-routers must stay behind it.
- `http.test.ts` asserts exact status codes and bodies – it is the safety net, do not edit its
  expectations in phases 1–2.

## 6. Review checklist

- [ ] `api.ts` < 3 KB, one router per resource.
- [ ] Lint rule blocks `routes → slicer/jobs`.
- [ ] No `as` casts on request bodies; responses typed.
- [ ] Smoke output identical to baseline.
