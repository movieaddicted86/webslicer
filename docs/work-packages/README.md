# Work packages

Self-contained implementation packages for contributors (human or LLM). The lead developer writes
them, reviews the result on the package branch and merges it.

Every package follows [CONVENTIONS.md](CONVENTIONS.md) and [CODING-GUIDELINES.md](CODING-GUIDELINES.md).

## Review follow-up (external review, 2026-10-22/23, base `eb00fa4`)

Focus: architecture, maintainability, easy framework/engine upgrades. WebSlicer runs in a home lab,
so network security items (login, SSRF, install channel) are deferred on purpose. Finding ids
(S…, B…, W…, N…, A…) refer to the review document and are quoted in each package for traceability.

Run the packages **in this order**; a package may start once the packages in "Needs" are merged.
Merged packages are kept in [docs/archive/](../archive/) and their status here is historical.

| Order | Id                  | Package                                                                       | Needs | Size     | Status    |
| ----- | ------------------- | ----------------------------------------------------------------------------- | ----- | -------- | --------- |
| 1     | `q1-toolchain`      | [Toolchain unblock (TS 6, ESLint, Dependabot)](../archive/WP-Q1-Toolchain.md) | –     | 3 phases | done      |
| 2     | `q2-slicer-cli`     | [One seam for all PrusaSlicer CLI calls](../archive/WP-Q2-SlicerCli.md)       | –     | 4 phases | done      |
| 3     | `q3-server-routes`  | [Split the API router, typed contract](../archive/WP-Q3-ServerRoutes.md)      | q2    | 4 phases | done      |
| 4     | `q4-web-store`      | [Split the plater slice, three.js boundary](../archive/WP-Q4-WebStore.md)     | q1    | 4 phases | done      |
| 5     | `q5-bugfixes`       | [Remaining bugs](../archive/WP-Q5-Bugfixes.md)                                | q4    | 5 phases | done      |
| 6     | `q6-preflight`      | [G-code preflight hardening (printer safety)](../archive/WP-Q6-Preflight.md)  | –     | 3 phases | done      |
| 7     | `q7-slicer-upgrade` | [PrusaSlicer upgrade runbook](../archive/WP-Q7-SlicerUpgrade.md)              | q2    | 2 phases | done      |
| 8     | `q8-housekeeping`   | [React Compiler prep, docs diet, CSS split](WP-Q8-Housekeeping.md)            | q4    | 4 phases | in review |
| –     | `p1.3-instances`    | [Instances](../archive/WP-P1.3-Instances.md)                                  | –     | 6 phases | done      |

Deferred (home lab, not planned): S1 login, S3 SSRF destination policy, S5 install channel,
N4 extra preflight commands beyond q6, N7 MCP owner scoping over REST, N9 PR workflow.

## Kickoff prompt

Give the implementing model access to the repository and start it with (replace `<ID>` and `<FILE>`):

> You are a senior TypeScript developer working on WebSlicer
> (https://github.com/movieaddicted86/webslicer). Read `docs/work-packages/CONVENTIONS.md`,
> `docs/work-packages/CODING-GUIDELINES.md` and `docs/work-packages/<FILE>` completely before
> changing anything. Implement the work package phase by phase on the branch `feature/<ID>`, one
> commit per phase, and verify each phase exactly as described. Follow the binding decisions; if
> one of them does not work, stop and explain instead of deviating. Stay inside the listed files
> unless a phase says otherwise. Do not merge into `main`. Finish with the handover report
> described in CONVENTIONS §8, including the before/after numbers each package asks for.

## Conventions specific to the review packages

- **Behaviour-preserving first.** Refactor phases must not change any HTTP status, body, UI text or
  slicing output. Proof: `npm test`, `npm run e2e:docker` green before and after, plus the checks
  named in the phase.
- **No new abstractions beyond what the package names.** No engine interface, no adapter layer
  around three.js, no API versioning, no DI container.
- **Comments:** no ticket ids in new comments (the commit message carries the id); keep the "why".
- **Numbers in the handover:** file sizes (bytes) of the files a package splits, before and after.
