# Work package Q5 – Remaining bugs

|            |                                                                                                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package id | `q5-bugfixes` (branch `feature/q5-bugfixes`)                                                                                                                                                                                                                                      |
| Findings   | B2 (rest), B7 (rest), N5, N6, N8b (double undo steps), N8c (keepalive marker), B1 (rest)                                                                                                                                                                                          |
| Base       | `main` after `q4-web-store` is merged (file names below refer to the split slices)                                                                                                                                                                                                |
| Read first | CONVENTIONS.md, CODING-GUIDELINES.md, this file                                                                                                                                                                                                                                   |
| Estimate   | 5 phases, one commit each                                                                                                                                                                                                                                                         |
| Allowed    | `web/src/state/**`, `web/src/plater/extruders.ts`, `web/src/three/viewer/usePlaterObjects.ts`, `web/src/components/**` (cut button disabled state only), `server/src/services/projects.ts`, `server/src/routes/projects.ts`, `server/src/mcp/toolProjects.ts`, tests next to them |

## 1. Goal

Fix the bugs that remained after the 2026-10-23 fixes. Each phase is one bug: a failing test
first, then the fix.

## 2. Bugs and acceptance criteria

**P1 – B2 rest: printer switch leaves extruder indices out of range.**
`selectPreset('printer')` in `slices/preset.ts` only trims `presets.filament` (`fil.length = n`); it
does not clamp `o.extruder`, `v.extruder`, MMU paint values or `paintExtruder` the way
`setExtruderCount` does with `clampObjectExtruders`/`clampMmuPaint`.

- AC-1.1 Switching from a 5-extruder to a 1-extruder printer clamps everything exactly like
  `setExtruderCount(1)`; `buildSliceRequest` never contains an extruder > count.
- Test: store test "printer switch clamps extruders".

**P2 – B7 rest: lost updates on server projects.**
`addModelFromLibrary`, `arrange` and `touchProject` in `services/projects.ts` load, modify and save
without serialisation; concurrent MCP calls lose updates.

- AC-2.1 A per-project promise-chain lock `withProjectLock(id, fn)` (same pattern as
  `services/printers.ts` `update()`). The callers load the project before calling the service, so
  the lock wraps load → modify → save **in the callers** (`routes/projects.ts`,
  `mcp/toolProjects.ts`), not only inside `addModelFromLibrary`.
- Test: 20 parallel `addModelFromLibrary` calls on one project → 20 models.

**P3 – N5: cut races.**
`cutSelection` in `slices/cut.ts` captures state before `await api.cut(...)` and writes after it.

- AC-3.1 While a cut request runs, the cut button is disabled (`cutBusy` flag) and a second call
  returns immediately.
- AC-3.2 After the response, if the object was deleted or its instance transform changed since the
  request started, the result is discarded with an info toast; no history entry is recorded.
- AC-3.3 One Ctrl+Z after a successful cut restores the uncut object (unchanged behaviour).

**P4 – N6 + N8b: undo memory and double steps.**
`history.ts` `snapshotObjects` copies every object's paint arrays on every `recordHistory()`
(up to 50 snapshots). `addObjects`, `duplicateObjects`, `addInstances` call `recordHistory()` and
then `arrange()`, which records again.

- AC-4.1 Snapshots share unchanged paint arrays by reference; a paint array is copied only when it
  is about to be mutated (copy-on-write in the paint actions). Test: 50 drags on a painted object
  allocate no new paint arrays (compare array identity).
- AC-4.2 Import, duplicate and add-instance are one undo step each (arrange inside the same step).
  Test: after `addObjects`, one `undo()` returns to the empty plater.

**P5 – N8c keepalive marker, B1 rest slab materials.**

- AC-5.1 In `slices/job.ts` `autosaveNow`, `markPendingFlush` runs **before** `await
writeCachedRequest(...)`; `KEEPALIVE_LIMIT` (60 KiB) is compared with the byte length
  (`new TextEncoder().encode(json).length`), not the character count.
- AC-5.2 `usePlaterObjects.ts` disposes slab materials and edge `LineBasicMaterial`s, not only
  geometries. Check: `renderer.info.memory` returns to baseline after adding and removing ten
  objects with height ranges.

## 3. Binding decisions

- Test first for each phase; the test must fail on the base commit (state that in the handover).
- No changes to API contracts or UI texts except the AC-3.2 toast (`"Cut discarded: the object changed while cutting"`).

## 4. Phases

One phase per bug P1–P5, in that order, each with its test. Commit messages:
`Fix: <summary> (q5-bugfixes)`. Final commit (docs/handover, not counted as a phase): CHANGELOG
"Fixed" bullet, handover with the failing-then-passing evidence per bug.

## 5. Review checklist

- [ ] Five tests that failed on the base and pass now.
- [ ] No extruder index > count in any slice request after a printer switch.
- [ ] Project writes serialised per project.
- [ ] Cut cannot run twice; stale results discarded.
- [ ] One undo step per import/duplicate/add-instance; paint arrays shared between snapshots.
