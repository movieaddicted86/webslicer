# Definition of done

Part of [CONVENTIONS.md](../CONVENTIONS.md) §5.

A work package (and each phase of it) is done only when all of this holds:

1. Both type checks pass, `npm test` passes, `npm run build` passes.
2. New pure logic has unit tests (server: `*.test.ts` next to the code, `node:test` + `assert`).
3. The feature was exercised in a real browser against a real slice (Docker server), including
   the acceptance criteria of the work package. Record what you checked and the observed result.
4. No errors in the browser console (except the known 404 of `/api/autosave/...?info` when no
   autosave exists).
5. Regression smoke test of the touched areas (see the work package), at least UAT-04, 05, 06,
   12 and 13 from `docs/UAT.md`.
6. Docs updated: `CHANGELOG.md` (Unreleased), `TODO.md` checkbox, `docs/Feature-Comparison.md`
   row, a new UAT case in `docs/UAT.md` for user-visible features, README only if setup changes.
