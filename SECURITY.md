# Security policy

WebSlicer is a self-hosted tool: it runs on your machine or network and talks to your printers. It
handles uploaded models, preset files and G-code, so a bug can matter beyond the browser tab.

## Supported versions

Security fixes go into the latest release and into `main`. Older pre-releases are not patched.

| Version                       | Supported                          |
| ----------------------------- | ---------------------------------- |
| 1.0.x (current)               | yes                                |
| < 1.0 (pre-release snapshots) | no – upgrade to the latest release |

The version you are running is shown in the UI (`/api/info`, `version`); it comes from the root
`package.json` of the checkout or image you built (see `npm run version:check`).

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

- Use GitHub's private reporting: <https://github.com/movieaddicted86/webslicer/security/advisories/new>
  ("Report a vulnerability"). This keeps the report and the fix private until a release is out.

Include what you can:

- the WebSlicer version and how you run it (Docker image, `npm start`, reverse proxy),
- the affected endpoint, file or feature,
- steps to reproduce, and what an attacker gains (e.g. code execution, file read outside the data
  dir, request forgery from a web page),
- the impact you expect and any suggested fix.

**Never include real secrets in a report** – redact API keys, MCP tokens and printer credentials. If
you must show a token, generate a throwaway one.

## What to expect

- Acknowledgement within about a week (this is a small, volunteer-run project).
- An assessment with a severity and a plan; for confirmed issues a fix on a private branch and a
  coordinated release.
- Credit in the changelog and the release notes unless you prefer to stay anonymous.

## Scope

In scope: the server (`server/`), the web app (`web/`), the shared code (`shared/`), the Docker
image and the Proxmox helper in this repository.

Out of scope: vulnerabilities in PrusaSlicer itself (report them to Prusa Research), in third-party
packages (report upstream – we bump them via Dependabot), and issues that only exist because the
operator deliberately exposed the app to the internet without a reverse proxy that authenticates
users. WebSlicer ships without login by design; see `docs/` and the README for the deployment
recommendation.

## Outbound requests

The server makes exactly two kinds of outbound request, both switched off by
`WEBSLICER_UPDATE_CHECK=off` (see [docs/installation.md](docs/installation.md#update-notice)):

- `api.github.com` – the daily "is there a newer image?" check (no payload, `User-Agent: webslicer`).
- `raw.githubusercontent.com/prusa3d/PrusaSlicer-settings` – the daily vendor profile check and, only
  after a click in the Printers dialog, a vendor bundle and the bed models and thumbnails it names.
  Vendor ids and file names are built by the server from fixed patterns; a downloaded bundle is
  validated locally before it replaces the installed one. Upstream publishes no signature, so the
  integrity of that download rests on TLS and the bundle validation, not on a signed artifact – an
  operator who does not want it can switch the check off and install bundles from a file instead.

## Hardening you can do as an operator

- Put WebSlicer behind a reverse proxy that requires authentication before exposing it beyond your
  LAN.
- Keep the image up to date; the build pins the PrusaSlicer AppImage by SHA-256.
- Use per-user MCP tokens, and disable MCP if you do not use it.
