# Work packages

Self-contained implementation packages for contributors (human or LLM). The lead developer writes
them, reviews the result on the package branch and merges it.

| Id             | Package                           | Status |
| -------------- | --------------------------------- | ------ |
| p1.3-instances | [Instances](WP-P1.3-Instances.md) | open   |

Every package follows [CONVENTIONS.md](CONVENTIONS.md).

## Kickoff prompt

Give the implementing model access to the repository and start it with:

> You are a senior TypeScript developer working on WebSlicer
> (https://github.com/movieaddicted86/webslicer). Read `docs/work-packages/CONVENTIONS.md` and
> `docs/work-packages/WP-P1.3-Instances.md` completely before changing anything. Implement the work
> package phase by phase on the branch `feature/p1.3-instances`, one commit per phase, and verify
> each phase as described (type checks, tests, browser checks against a real slice). Follow the
> binding design decisions; if one of them does not work, stop and explain instead of deviating.
> Do not merge into `main`. Finish with the handover report described in CONVENTIONS §8.
