# E2E fixtures

`data/` is the server's `DATA_DIR` for the suite: copying it into a throwaway directory before a run is
what makes the runs deterministic and independent of a developer's own `data/`.

- `installed_printers.json` installs **Original Prusa i3 MK3S & MK3S+** (0.4 nozzle). Every spec starts
  from that preset, so the bed size (250×210), the max height (210 mm) and the `160x120` thumbnail
  profile are the same on every machine.
- `presets/sla_print/E2E fixture – do not use.ini` is the **fixture marker**: a user preset no real
  instance has. `global-setup.ts` refuses to run when it is missing, _before_ anything is written – the
  suite deletes jobs and saves presets, printers and autosave files, so pointing it at a developer's own
  data (e.g. the compose stack on `localhost:8080`) would destroy that data. SLA on purpose: a user
  _print_ preset would be picked as the active print settings on startup, which the FFF UI never does
  with SLA presets. No spec uses it.
- **No physical printers** are seeded on purpose: the send spec creates the mock print hosts it needs
  through the API and deletes them again, and the printer dialog then always starts on its empty list
  (the t18 check that opened straight on a form of a seeded host was a fixture accident).

The library directory is created empty next to `data/`; the server seeds it with the bundled sample
STLs on first start (`server/src/samples.ts`). `e2e:docker` mounts a temp copy of both, so a run never
writes into this folder.
