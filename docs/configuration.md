# Configuration

WebSlicer is configured through environment variables: on Docker with `-e`/Compose, on a Proxmox
install through `/etc/webslicer/webslicer.env` (the installer keeps that file across updates and only
refreshes `PORT` and appends missing lines). The **build arguments** configure the image itself and
are passed with `docker build --build-arg`.

| Variable                          | Default                                     | Meaning                                                                                                                                                |
| --------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRUSASLICER_VERSION` (build arg) | `2.9.6`                                     | PrusaSlicer version; the default is pinned by a SHA-256                                                                                                |
| `PRUSASLICER_URL` (build arg)     | –                                           | Custom AppImage URL (overrides version/arch)                                                                                                           |
| `PRUSASLICER_SHA256` (build arg)  | –                                           | SHA-256 of a custom AppImage; without it a custom URL/version is downloaded unverified (warning)                                                       |
| `GIT_COMMIT` (build arg)          | `unknown`                                   | Commit the image was built from – the "update available" check compares it with the branch head (see [installation.md](installation.md#update-notice)) |
| `GIT_BRANCH` (build arg)          | `main`                                      | Branch that build follows; the head of this branch is the comparison target                                                                            |
| `PORT`                            | `8080`                                      | HTTP port                                                                                                                                              |
| `DATA_DIR`                        | `/data`                                     | Presets, models, jobs, printer list, autosave                                                                                                          |
| `LIBRARY_DIR`                     | `/library` (Compose) or `$DATA_DIR/library` | File library for STL/STEP/3MF/G-code, meant to be mounted                                                                                              |
| `MAX_JOBS`                        | `2`                                         | Parallel slicing jobs                                                                                                                                  |
| `MAX_CLI_PROCESSES`               | `MAX_JOBS`                                  | PrusaSlicer processes allowed at once across slicing, STEP conversion and cut (further calls wait)                                                     |
| `MAX_UPLOAD_BYTES`                | `524288000`                                 | Maximum upload size per model                                                                                                                          |
| `JOB_RETENTION`                   | `50`                                        | Jobs (G-code) kept                                                                                                                                     |
| `SLICE_TIMEOUT_MS`                | `3600000`                                   | Timeout per slicing job                                                                                                                                |
| `PRUSASLICER_BIN`                 | `/opt/prusaslicer/AppRun`                   | Path to the slicer binary                                                                                                                              |
| `PRUSASLICER_RESOURCES`           | auto                                        | Path to the `resources` directory (profiles)                                                                                                           |
| `MCP_TOKEN`                       | –                                           | Bearer token for the agent endpoint `/mcp`; without it the endpoint does not exist (see [mcp.md](mcp.md))                                              |
| `ALLOWED_HOSTS`                   | –                                           | Extra host names the API accepts in `Host`/`Origin`, comma-separated (e.g. `webslicer.lan,nas:8080`) – for a NAS/LXC host name or a reverse proxy      |
| `WEBSLICER_UPDATE_CHECK`          | on                                          | `off`/`false`/`0`/`no` stops the daily GitHub update check and every outbound request it makes (see [installation.md](installation.md#update-notice))  |

Example: `docker build --build-arg PRUSASLICER_VERSION=2.9.5 -t webslicer .`

The `ALLOWED_HOSTS` rules (DNS-rebinding guard, reverse proxies) are explained in
[installation.md](installation.md#opening-the-app-by-ip-host-name-or-reverse-proxy).

## On a Proxmox install

The systemd service reads `/etc/webslicer/webslicer.env`. Add a line and restart:

```bash
echo 'MCP_TOKEN=change-me' >> /etc/webslicer/webslicer.env
systemctl restart webslicer
```

## Settings inside the app

The slicing settings are not environment variables: they are PrusaSlicer presets that the app edits
and stores under `DATA_DIR`. Two safety layers check them before and after slicing – see
[safety.md](safety.md).
