# Docs rules

Part of [CONVENTIONS.md](../CONVENTIONS.md) §5.

### A changelog entry is three lines at most

`CHANGELOG.md` states what the user gets, in **one to three lines per change**, with the task id in
brackets and grouped under _Added / Changed / Fixed / Security_. The reasoning – measured numbers, the
reproduction, the exact rule set, deviations – belongs in `docs/` or the task report and is linked, not
copied. The long-form entries of the older releases are kept verbatim in
`docs/archive/CHANGELOG-details-rc3-rc5.md`. A reviewer rejects an entry that needs a fourth line.

### The main README stays short

`README.md` is the shop window, not the manual (Robert, 2026-10-24): **at most ~150 lines**, in this order – what WebSlicer is (two sentences), one hero screenshot, the feature
list as short grouped bullets with links, quick start (the shortest working install), a link table to `docs/`, contributing, licence. Details, option lists, long how-tos,
configuration tables and design notes belong in `docs/` (`features.md`, `installation.md`, `configuration.md`, `development.md`, …) and are only linked. A task that needs to
document something adds it to `docs/`, adds at most one line or one link to the README, and **never grows the README by more than a few lines**; if the README is over the limit
the task moves text out to `docs/` first. The reviewer rejects a README that got longer without a reason.
