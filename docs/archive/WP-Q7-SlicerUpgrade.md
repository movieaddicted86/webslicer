# Work package Q7 – PrusaSlicer upgrade runbook

|            |                                                                                                                                                                                                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q7-slicer-upgrade` (branch `feature/q7-slicer-upgrade`)                                                                                                                                                                                                                                 |
| Findings   | A1                                                                                                                                                                                                                                                                                       |
| Base       | `main` after `q2-slicer-cli` is merged                                                                                                                                                                                                                                                   |
| Read first | CONVENTIONS.md, this file                                                                                                                                                                                                                                                                |
| Estimate   | 2 phases, one commit each                                                                                                                                                                                                                                                                |
| Allowed    | `server/src/slicer/fixtures/README.md`, new `docs/PrusaSlicer-Upgrade.md`, root `package.json` scripts, new `server/scripts/pins-update.ts`, `server/scripts/help-diff.ts`, `server/src/slicer/schema.pin.test.ts` (comments only), `.github/workflows/ci.yml` (one step in the e2e job) |

## 1. Goal

Moving from PrusaSlicer 2.9.6 to the next version is a checklist and two commands, not a search
through the code. Today the version-specific parts are spread over the Dockerfile, the installer,
fixtures, pin tests, `configLimits.ts`, `serverOnly.ts`, preflight rules and several regexes, and
`fixtures/README.md` points to a wrong file (`threemf/write.pin.test.ts`; the test is
`threemf.pin.test.ts`).

## 2. Acceptance criteria

- AC-1 `docs/PrusaSlicer-Upgrade.md` lists every place that depends on the version, each with what
  to check and how. At least: Dockerfile and `proxmox/install.sh` (version + SHA-256 per arch);
  fixtures `help-fff.txt`, `help-sla.txt`, `bundle-keys.json`, `schema.json`, `written-3mf.json`; `schema.pin.test.ts`
  option counts; `threemf.pin.test.ts`; `layout/fff.data.ts` and `knownOptions.data.ts` (new/removed
  options land in "Other options"); `shared/src/safety/configLimits.ts` soft ranges +
  `limits-sweep.ts`; `shared/src/serverOnly.ts` (new host-acting options?); preflight M907 exception;
  regexes in `gcodeInfo.ts`, progress `^\s*(\d{1,3})\s*=>`, 3MF metadata names
  (`Slic3r_PE.config`, `Prusa_Slicer_*.xml`); `CONVENTIONS.md` §1 version wording.
- AC-2 `npm run pins:update` first **captures** `--help-fff`, `--help-sla` and the bundle keys from
  the installed binary into the fixtures (new code – today nothing does that), then runs the
  existing `UPDATE_PINS=1` step, which only rewrites `schema.json` and `written-3mf.json` from the
  fixtures. It prints a diff summary: options added, removed, changed type/default. The option
  counts in `schema.pin.test.ts` (367 / 158 at 2.9.6) are updated by hand; the summary prints the
  new counts.
- AC-3 `server/scripts/help-diff.ts` compares the live `--help-fff`/`--help-sla` of the binary in the
  Docker image with the checked-in fixtures; the e2e CI job runs it and fails on a difference. This
  catches a Dockerfile version bump without regenerated fixtures.
- AC-4 `fixtures/README.md` path fixed and linking to the runbook.

## 3. Binding decisions

- No engine abstraction, no multi-version support at runtime. One version at a time.
- The runbook is for a human or an LLM; write it as a numbered checklist with commands.

## 4. Phases

1. Runbook + README fix (AC-1, AC-4). Commit: `Docs: PrusaSlicer upgrade runbook (q7-slicer-upgrade)`
2. `pins:update`, `help-diff`, CI step (AC-2, AC-3). Commit: `Tooling: pin update and help diff for slicer upgrades (q7-slicer-upgrade)`

## 5. Review checklist

- [ ] Every version-dependent place from AC-1 is in the runbook.
- [ ] CI fails when the image's slicer and the fixtures disagree.
