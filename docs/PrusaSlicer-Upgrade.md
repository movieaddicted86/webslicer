# PrusaSlicer upgrade runbook

WebSlicer wraps **one** PrusaSlicer version at a time (currently 2.9.6). There is no engine
abstraction and no multi-version support at runtime: an upgrade is a version bump plus a short
checklist of places that encode something about that version, and two commands that capture the
slicer's own output into the fixtures the tests build on.

This page is that checklist. Work through it top to bottom; every step names the file, what to check
and how to check it. The numbers below (367 / 158 options, the preset counts) are the 2.9.6 values and
are updated by the upgrade itself.

## 0. Before you start

```bash
git switch main && git pull
docker build -t webslicer:upgrade .          # slow: npm ci + the AppImage download, cached afterwards
npm ci
npm run build -w shared                       # the scripts below import the built shared package
```

Try the new version first without touching the repository – the image build accepts the version and
its checksum as build arguments:

```bash
docker build --build-arg PRUSASLICER_VERSION=2.9.7 \
  --build-arg PRUSASLICER_SHA256=<sha256 of the x86_64 AppImage> \
  -t webslicer:upgrade .
docker run --rm --entrypoint /opt/prusaslicer/AppRun webslicer:upgrade --help | head -n 1
```

If the binary does not start, stop here: the community AppImage for that version is not usable (the
Dockerfile fallback for x86_64 is [gneiss15/PrusaSlicer.AppImage](https://github.com/gneiss15/PrusaSlicer.AppImage),
for arm64 [davidk/PrusaSlicer-ARM.AppImage](https://github.com/davidk/PrusaSlicer-ARM.AppImage)).

## 1. Bump the version, architecture by architecture

The version and its SHA-256 live in three places that must agree.

| File                 | What to change                                                                                                                                                                                                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`         | `ARG PRUSASLICER_VERSION` and `ARG DEFAULT_PRUSASLICER_VERSION`; `PRUSASLICER_SHA256_AMD64` and `PRUSASLICER_SHA256_ARM64` (the checksums of the **default** version per architecture); the download URL patterns in the `slicer` stage if the AppImage repositories renamed their assets |
| `proxmox/install.sh` | `DEFAULT_PRUSASLICER_VERSION`, `DEFAULT_PRUSASLICER_SHA256_x86_64`, `DEFAULT_PRUSASLICER_SHA256_aarch64`, and the URL patterns of the architecture `case`                                                                                                                                 |
| `docker-compose.yml` | the `PRUSASLICER_VERSION` build argument                                                                                                                                                                                                                                                  |

Take the checksums from the release assets themselves – never copy them from a web page:

```bash
curl -fL -O https://github.com/gneiss15/PrusaSlicer.AppImage/releases/download/<version>/PrusaSlicer-<version>-x86_64_GN.AppImage
curl -fL -O https://github.com/davidk/PrusaSlicer-ARM.AppImage/releases/download/version_<version>/PrusaSlicer-<version>-aarch64-full.AppImage
sha256sum PrusaSlicer-*.AppImage
```

Both images verify the download before extracting it; a wrong hash fails the build with
`PrusaSlicer checksum mismatch`. The installer `proxmox/install.sh` does the same, so a stale hash
there breaks every upgrade of an existing installation.

## 2. Capture the slicer's own output into the fixtures

`npm run pins:update` replaces the captured fixtures in `server/src/slicer/fixtures/` with the output
of the **new** binary and then rewrites the pins derived from them:

```bash
# against the image built in step 0 (short-lived containers for the help output and the bundles)
PRUSASLICER_DOCKER_IMAGE=webslicer:upgrade npm run pins:update

# or against a running container, e.g. `npm run e2e:docker`'s stack
PRUSASLICER_DOCKER_CONTAINER=e2e npm run pins:update

# or against a local PrusaSlicer install
PRUSASLICER_BIN="/c/Program Files/Prusa3D/PrusaSlicer/prusa-slicer-console.exe" npm run pins:update
```

A local install needs its vendor bundles too; the script looks below the binary (`usr/resources/profiles`, …)
and takes `PRUSASLICER_PROFILES` or `PRUSASLICER_RESOURCES` when it cannot find them.

The command prints a diff summary of the schema it derives from the help output: **options added,
options removed, and options whose type or default changed**, plus the new option counts
(`--help-fff` / `--help-sla` entries). Read that summary before committing – it is where a renamed
option, a changed unit or a new default shows up.

What it writes:

| Fixture                        | Content                                                      | How                                          |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------- |
| `help-fff.txt`, `help-sla.txt` | the raw `--help-fff` / `--help-sla` output                   | captured from the binary                     |
| `bundle-keys.json`             | the config keys of every vendor preset, per preset type      | captured from the installed vendor bundles   |
| `schema.json`                  | the whole `/api/schema` payload derived from the three above | `UPDATE_PINS=1` run of `schema.pin.test.ts`  |
| `written-3mf.json`             | entry names and text of one written 3MF project              | `UPDATE_PINS=1` run of `threemf.pin.test.ts` |

Review the diff of every fixture in the commit. A change in `written-3mf.json` is **not** caused by
the slicer version (the writer is ours) – if it changes, something in the 3MF writer changed as well
and belongs in its own commit with its own explanation.

## 3. Update the hand-maintained pins

These two are intentionally manual, because a number changing means "look at what changed":

- **`server/src/slicer/schema.pin.test.ts`** – the option counts `assert.equal(raw.length, 367)` and
  `assert.equal(parseHelp(helpSla, known).length, 158)`. `pins:update` printed the new numbers.
- **`server/src/slicer/threemf.pin.test.ts`** – the 3MF format. `written-3mf.json` is regenerated, but
  read the diff: entry names (`Metadata/Slic3r_PE.config`, `Metadata/Prusa_Slicer_*.xml`), the project
  config and the model config are PrusaSlicer's formats, and a new version may rename or add entries.

## 4. Look at the new and removed options

`schema.json` is rebuilt automatically, but the **curated layout and metadata are not**. New options
show up under "Other options" in their help category until they are placed; removed options disappear
silently, so their curated entries become dead data.

- **`server/src/slicer/layout/fff.data.ts`** – the tab/page/group layout. Place every new option of a
  preset type the UI edits, in the group where PrusaSlicer shows it. An option that disappears from
  the help output has to be removed from the layout.
- **`server/src/slicer/layout/knownOptions.data.ts`** – label, value type, enum labels, mode,
  `sidetext`, vector/nullable flags. A renamed enum value or a new enum member needs its `enumLabels`
  entry extended; a changed default that the help text no longer prints needs a `bool`/`float` check.
- **`server/src/slicer/layout/keySets.ts`** – the per-extruder vector key sets. A new option that is a
  per-extruder vector in the help output belongs here.

The pin test (`schema.pin.test.ts`) and the layout are independent: the pin proves the _derived_
schema, the layout is the _curation_ on top of it.

## 5. Run the checks the new version can break

```bash
PRUSASLICER_DOCKER_IMAGE=webslicer:upgrade npm run help-diff
# the sweep needs the bundle directory; copy it out of the image once
docker create --name pins webslicer:upgrade && docker cp pins:/opt/prusaslicer/usr/resources/profiles ./tmp-profiles && docker rm -f pins
PRUSASLICER_PROFILES=./tmp-profiles npx tsx server/scripts/limits-sweep.ts
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

- **`help-diff.ts`** compares the live `--help-fff`/`--help-sla` of the image with the checked-in
  fixtures and fails on a difference. CI runs it in the E2E job. It catches exactly one mistake: a
  version bump in the Dockerfile whose fixtures were not regenerated.
- **`limits-sweep.ts`** runs the configuration limits over every bundled system preset. It must report
  **0 blocking findings**; a blocking preset means a limit is too narrow for the new bundles and has
  to be widened (the sweep prints the preset and the rule). The soft ranges in
  `shared/src/safety/configLimits.ts` come from the **2.9.6** filament profiles (table in the module
  doc) – re-measure them with the sweep output if the new bundles moved the temperature windows.
- **`npm test`** covers the pin tests, the help parser, G-code statistics and preflight.
- **The full E2E suite runs in CI** (four shards against a freshly built image). Run it locally only
  when the upgrade changes something the suite asserts on; `npm run e2e:docker` builds the image from
  the current Dockerfile and runs everything.

## 6. Places that encode a version-specific behaviour

These are the remaining version-dependent spots. Each table row is a question to answer against the
new release notes and the diff of the captured help output, not a mechanical edit.

| Place                                                                  | What depends on the version                                                                                                                                                                                                                                                       | How to check                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/slicer/help.ts`                                            | the parser for the `--help-fff`/`--help-sla` format: option lines, type hints (`N`, `ABCD`, `X,Y`, `X,Y,Z`), category lines, alias selection via the bundle keys                                                                                                                  | the pin test parses the new help; a parse that suddenly finds far fewer options (the summary counts drop) means the format changed                                                      |
| `server/src/slicer/optionDef.ts`                                       | type and default derived from the help text, including the trailing `(… default: X)` block                                                                                                                                                                                        | the `pins:update` summary lists every type/default change                                                                                                                               |
| `server/src/slicer/bundles.ts`                                         | vendor bundle parsing and inheritance (`inherits`, `renamed_from`, `alias`)                                                                                                                                                                                                       | `limits-sweep.ts` and the preset list: a bundle that fails to parse logs `[bundles] failed to parse …`                                                                                  |
| `server/src/slicer/commands.ts`                                        | the CLI flags: `--export-gcode`, `--export-sla`, `--export-stl`, `--cut`, `--load`, `--dont-arrange`, `--no-ensure-on-bed`, `--help`, `--help-fff`, `--help-sla`                                                                                                                  | `commands.test.ts`; a renamed flag makes every job fail with a CLI error                                                                                                                |
| `server/src/slicer/cli.ts`                                             | the version line (`PrusaSlicer-<version>`) and the AppImage entry point `/opt/prusaslicer/AppRun`                                                                                                                                                                                 | `GET /api/meta` reports `slicerVersion`; the Dockerfile's build-time `AppRun --help` check                                                                                              |
| `server/src/slicer/gcodeInfo.ts`                                       | the statistics comments: `; generated by PrusaSlicer <version>`, `; estimated printing time (normal mode) = …`, `; filament used [mm] = …` / `[cm3]` / `[g]`, `; filament cost = …`, `; layer_height = …`                                                                         | `gcodeInfo.test.ts`, then slice the sample model once and compare the preview panel with the G-code header                                                                              |
| `server/src/jobs.ts`                                                   | the progress lines `^\s*(\d{1,3})\s*=>\s*(.*)$` and `^\s*=>\s*…` that drive the SSE progress events, and the warning/error word scan                                                                                                                                              | slice anything: the progress bar and the stage names come from these lines                                                                                                              |
| `server/src/slicer/gcodeInfo.ts`                                       | the warning block format (`print warning: …`, `Object name: …`)                                                                                                                                                                                                                   | `gcodeInfo.test.ts`; slice a model with an empty layer to see a real block                                                                                                              |
| `server/src/slicer/threemf/` (`write.ts`, `read.ts`, `customGcode.ts`) | the 3MF metadata entry names and formats: `Metadata/Slic3r_PE.config`, `Metadata/Slic3r_PE_model.config`, `Metadata/Slic3r_PE_layer_heights_profile.txt`, `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml`, `Metadata/Prusa_Slicer_layer_config_ranges.xml`                   | `written-3mf.json` diff and `threemf.test.ts`; import a 3MF written by the new PrusaSlicer GUI once and check paint, height ranges and custom G-codes survive                           |
| `web/src/gcode/parser.ts`                                              | the G-code markers the preview reads: `;Z:`, `;TYPE:`, `;HEIGHT:`, `;WIDTH:`, `;LAYER_CHANGE`                                                                                                                                                                                     | `web/src/gcode/parser.test.ts` and the preview of a freshly sliced job                                                                                                                  |
| `shared/src/serverOnly.ts`                                             | the options the server refuses because PrusaSlicer acts on them **on the host** (`post_process`, `output_filename_format`)                                                                                                                                                        | read the new release notes for a new host-acting option (another shell hook, a path or a URL the slicer writes to); add it with its reason, and check `configMerge`/MCP still refuse it |
| `shared/src/safety/configLimits.ts` + `server/scripts/limits-sweep.ts` | the global typo catchers and the soft ranges by `filament_type`, both measured against the bundled profiles                                                                                                                                                                       | the sweep (step 5) and the doc table in the module                                                                                                                                      |
| `shared/src/safety/gcodePreflight.ts`                                  | the **M906/M907 exception**: PrusaSlicer's own printer presets set the extruder current in their start/end G-code, so those commands warn instead of block. A new preset family that does the same, or a new host-acting command, changes the rule set (`PREFLIGHT_VERSION` bump) | `gcodePreflight.test.ts` and the send dialog of the bundled MK3S/MK4S presets                                                                                                           |
| `web/src/plater/plateCheck.ts`                                         | the plate checks that reproduce PrusaSlicer's own refusal (overlap, skirt/brim beyond the bed, sequential-print clearance)                                                                                                                                                        | `plateCheck.test.ts` and the notes in it: the rules were measured against 2.9.6                                                                                                         |
| `server/scripts/api-smoke.ts`                                          | the normalisation of version-specific text (`PrusaSlicer 2.9.6 on …`) and the response shapes                                                                                                                                                                                     | run it against the image once if the API snapshot changed                                                                                                                               |
| `e2e/specs/`                                                           | expectations that quote the slicer's output (`send.spec.ts`: the MK3S preset's own `M907` lines; `preview.spec.ts`: header and statistics)                                                                                                                                        | CI; a red shard after the bump names the spec                                                                                                                                           |

## 7. Documentation touched by the version

```bash
grep -rn "2\.9\.6" --include=*.md --include=*.yml --include=Dockerfile --include=*.sh . | grep -v node_modules
grep -rn "PrusaSlicer 2\.9" --include=*.md . | grep -v node_modules
```

Update at least:

- `docs/work-packages/CONVENTIONS.md` §1 – the "PrusaSlicer 2.9 CLI" / "PrusaSlicer 2.9" wording.
- `docs/configuration.md` – the `PRUSASLICER_VERSION` default and the custom-version example.
- `docs/safety.md` – the soft-range numbers and the preset counts of the sweep.
- `docs/Feature-Comparison.md`, `README.md` (badge), `THIRD_PARTY_NOTICES.md` – the engine version.
- `docs/MCP-Concept.md` – the option counts of the MCP allowlist (they come from the generated schema).
- `CHANGELOG.md` – one entry "Upgrade PrusaSlicer to <version>", with the pins summary.
- `server/src/slicer/fixtures/README.md` – the version in its first line and its file table.
- Comments that name a version as **measured** (`shared/src/safety/configLimits.ts`,
  `shared/src/safety/gcodePreflight.ts`, `web/src/plater/plateCheck.ts`,
  `server/src/services/serverOnly.test.ts`): re-read them; a measured claim that no longer holds is a
  stale comment, not a code change.

## 8. Finish

1. `npm run format` and commit one phase per step (version bump, fixtures, curation, docs).
2. Push the branch; CI runs the full E2E suite, `help-diff` fails if the image and the fixtures
   disagree.
3. Slice the sample model once in a running container and compare the preview (time, filament,
   layers) with the G-code header – the fastest end-to-end sanity check.
4. Merge only with a green CI; the upgrade commit message names the new version.

## Checklist (copy into the pull request)

```text
[ ] Dockerfile: version, default version, SHA-256 per arch, URL patterns
[ ] proxmox/install.sh: version, SHA-256 per arch, URL patterns
[ ] docker-compose.yml: version build argument
[ ] npm run pins:update – summary reviewed (added / removed / type or default changed)
[ ] schema.pin.test.ts counts updated by hand
[ ] threemf.pin.test.ts – written-3mf.json diff reviewed
[ ] layout/fff.data.ts – new options placed, removed options dropped
[ ] layout/knownOptions.data.ts, keySets.ts – labels, enums, vectors
[ ] limits-sweep.ts – 0 blocking findings, soft ranges re-measured
[ ] serverOnly.ts – new host-acting options
[ ] preflight M906/M907 exception still right
[ ] gcodeInfo.ts / jobs.ts progress regexes / 3MF metadata names
[ ] docs and CONVENTIONS §1 wording
[ ] help-diff green, CI green
[ ] sample slice compared with its G-code header
```
