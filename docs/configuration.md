# Configuration

WebSlicer is configured through environment variables: on Docker with `-e`/Compose, on a Proxmox
install through `/etc/webslicer/webslicer.env` (the installer keeps that file across updates and only
refreshes `PORT` and appends missing lines). The **build arguments** configure the image itself and
are passed with `docker build --build-arg`.

| Variable                          | Default                                     | Meaning                                                                                                                                                                                   |
| --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRUSASLICER_VERSION` (build arg) | `2.9.6`                                     | PrusaSlicer version; the default is pinned by a SHA-256                                                                                                                                   |
| `PRUSASLICER_URL` (build arg)     | –                                           | Custom AppImage URL (overrides version/arch)                                                                                                                                              |
| `PRUSASLICER_SHA256` (build arg)  | –                                           | SHA-256 of a custom AppImage; without it a custom URL/version is downloaded unverified (warning)                                                                                          |
| `GIT_COMMIT` (build arg)          | `unknown`                                   | Commit the image was built from – the "update available" check compares it with the branch head (see [installation.md](installation.md#update-notice))                                    |
| `GIT_BRANCH` (build arg)          | `main`                                      | Branch that build follows; the head of this branch is the comparison target                                                                                                               |
| `PORT`                            | `8080`                                      | HTTP port                                                                                                                                                                                 |
| `DATA_DIR`                        | `/data`                                     | Presets, models, jobs, printer list, autosave                                                                                                                                             |
| `LIBRARY_DIR`                     | `/library` (Compose) or `$DATA_DIR/library` | File library for STL/STEP/3MF/G-code, meant to be mounted                                                                                                                                 |
| `MAX_JOBS`                        | `2`                                         | Parallel slicing jobs                                                                                                                                                                     |
| `MAX_CLI_PROCESSES`               | `MAX_JOBS`                                  | PrusaSlicer processes allowed at once across slicing, STEP conversion and cut (further calls wait)                                                                                        |
| `MAX_UPLOAD_BYTES`                | `524288000`                                 | Maximum upload size per model                                                                                                                                                             |
| `JOB_RETENTION`                   | `50`                                        | Jobs (G-code) kept                                                                                                                                                                        |
| `SLICE_TIMEOUT_MS`                | `3600000`                                   | Timeout per slicing job                                                                                                                                                                   |
| `PRUSASLICER_BIN`                 | `/opt/prusaslicer/AppRun`                   | Path to the slicer binary                                                                                                                                                                 |
| `PRUSASLICER_RESOURCES`           | auto                                        | Path to the `resources` directory (profiles)                                                                                                                                              |
| `MCP_TOKEN`                       | –                                           | Bearer token for the agent endpoint `/mcp`; without it the endpoint does not exist (see [mcp.md](mcp.md))                                                                                 |
| `ALLOWED_HOSTS`                   | –                                           | Extra host names the API accepts in `Host`/`Origin`, comma-separated (e.g. `webslicer.lan,nas:8080`) – for a NAS/LXC host name or a reverse proxy                                         |
| `WEBSLICER_UPDATE_CHECK`          | on                                          | `off`/`false`/`0`/`no` stops the daily GitHub update check and every outbound request it makes, including the vendor profile check (see [installation.md](installation.md#update-notice)) |

Example: `docker build --build-arg PRUSASLICER_VERSION=2.9.5 -t webslicer .`

The `ALLOWED_HOSTS` rules (DNS-rebinding guard, reverse proxies) are explained in
[installation.md](installation.md#opening-the-app-by-ip-host-name-or-reverse-proxy).

## On a Proxmox install

The systemd service reads `/etc/webslicer/webslicer.env`. Add a line and restart:

```bash
echo 'MCP_TOKEN=change-me' >> /etc/webslicer/webslicer.env
systemctl restart webslicer
```

## Vendor profile updates

The vendor bundles (the printer/filament/print presets of every vendor) ship in the image. A self-hosted
install can replace them without rebuilding the image: **Printers → Vendor profiles** shows every
installed vendor as _installed version → available version_ and offers **Update** per vendor and
**Update all**. The switch `WEBSLICER_UPDATE_CHECK` (see above) governs it:

- **on** (default): the server reads `index.idx` of the fixed repository
  `raw.githubusercontent.com/prusa3d/PrusaSlicer-settings/master/live/<VendorId>/` at most once per
  24 h and only for vendors that are installed already. A check never installs anything; the Update
  button does. A bundle the installed PrusaSlicer cannot run (`min_slic3r_version`/
  `max_slic3r_version`) is not offered.
- `off` / `false` / `0` / `no`: no request at all. The dialog says "Online updates are disabled" and
  offers **Install from file** – pick a vendor `.ini` (for example the one from the repository) and it
  goes through the same checks.

What an install does:

1. Download the bundle to a temporary file under `DATA_DIR` (10 s timeout, redirects refused, 5 MB cap).
2. Validate before anything changes: the same vendor, a higher `config_version`, readable presets, the
   **same configuration-limit sweep** the bundled profiles are checked with, and the preflight rules
   over the start/end G-code. Any `block` finding refuses the bundle, the installed one stays, and the
   dialog lists the preset and rule behind each finding. G-code findings the vendor's own current
   bundle already trips (PrusaSlicer's bundles set `M92` in their start G-code) are reported, not
   refused – otherwise every official bundle would be refused.
3. Write `<DATA_DIR>/vendor/<VendorId>.ini` atomically (the replaced file is kept as `.ini.prev`) and
   reload the bundles. When a bundle is installed for the first time, the image's copy is the rollback
   target.
4. Report the user presets that inherit from a system preset the new bundle no longer has
   ("N user presets reference removed profiles"). Nothing is deleted or rewritten.

**Revert** in the same dialog restores the previous file, or drops the installed one so the image's
copy is used again. The bundle chosen per vendor is always the one with the highest `config_version`,
so an older file in `DATA_DIR` never hides a newer one from the image.

Upstream publishes **no signature** for these bundles. The integrity of an install rests on TLS and on
the validation above, not on a signed artifact. The repository is maintained by Prusa Research as the
source for PrusaSlicer's bundled profiles; since PrusaSlicer 2.8 it is split into per-printer
repositories (`PrusaSlicer-settings-prusa-fff` and friends), and the `live/` folders still serve the
older bundles – a vendor whose folder has no newer version simply shows "up to date".

## Settings inside the app

The slicing settings are not environment variables: they are PrusaSlicer presets that the app edits
and stores under `DATA_DIR`. Two safety layers check them before and after slicing – see
[safety.md](safety.md).
