# Slicer fixtures (T-028)

Captured output of PrusaSlicer 2.9.6 that the pin tests build on. They make the refactoring steps of
R-11 verifiable without the slicer binary: any change to the layout tables, the option metadata, the
help parser or the 3MF writer shows up as a diff.

| File                           | Content                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `help-fff.txt`, `help-sla.txt` | `prusa-slicer --help-fff` / `--help-sla` (the two strings the server caches)                                   |
| `bundle-keys.json`             | the config keys of every preset of the installed vendor bundles, per preset type (sorted)                      |
| `schema.json`                  | `buildSchema(help-fff, help-sla, 'test', bundleKeys)` – the whole `/api/schema` payload                        |
| `written-3mf.json`             | entry names and text of one `build3mf` project (volumes, paint, height ranges, custom G-codes, project config) |

The files come from PrusaSlicer's public resources (AGPL-3.0-or-later, like this project).

**Regenerating.** Only after an _intended_ change of the layout, the option metadata, the help parser
or the 3MF writer:

```sh
UPDATE_PINS=1 npx tsx --test server/src/slicer/schema.pin.test.ts server/src/slicer/threemf/write.pin.test.ts
```

Then review the fixture diff in the commit – it is the proof of what changed.
