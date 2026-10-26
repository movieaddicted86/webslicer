# Installation

WebSlicer runs as a **Docker container** or natively in a **Proxmox VE LXC** (Debian 12/13, Ubuntu
22.04+). Both ways serve the same app on one HTTP port (default 8080); the README has the short
version, this page the details. All environment variables are listed in
[configuration.md](configuration.md).

## Docker

```bash
docker compose up -d
# → http://localhost:8080
```

Or without Compose:

```bash
docker build -t webslicer .
docker run -d --name webslicer -p 8080:8080 -v webslicer-data:/data -v /path/to/models:/library webslicer
```

`/data` holds settings, profiles, printers and jobs; `/library` is the file library you can mount on a
folder or NAS share (default in Compose: `./library`). The library is seeded with the bundled sample
models on first start while it is empty.

### Run the published image

A release tag (`v*`) builds the image for **linux/amd64** and publishes it, so from the first release
on there is nothing to build:

```bash
docker run -d --name webslicer -p 8080:8080 \
  -v webslicer-data:/data -v /path/to/models:/library \
  ghcr.io/movieaddicted86/webslicer:latest
```

**arm64 is not published yet.** On arm64 hardware (a Raspberry Pi, an arm64 NAS) build the image
yourself with `docker compose build` – the Dockerfile already handles arm64. A native arm64 release is
the next step ([CHANGELOG](../CHANGELOG.md)).

| Registry   | Image                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GHCR       | `ghcr.io/movieaddicted86/webslicer`                                                                                                       |
| Docker Hub | the name the maintainer configured (repository variable `DOCKERHUB_REPOSITORY`, see [Releasing an image](#releasing-an-image-maintainer)) |

**Tags.** `<version>` is the release without the `v` (`1.2.3`), `latest` follows the newest release and
`sha-<commit>` names the exact build. While the project is pre-1.0, `latest` follows every tag,
release candidates included; pin an exact version to stay where you are.

The Compose file builds from source. To use the published image, replace `build: .` with the image:

```yaml
services:
  webslicer:
    image: ghcr.io/movieaddicted86/webslicer:latest
    ports:
      - '8080:8080'
    volumes:
      - webslicer-data:/data
      - ./library:/library
volumes:
  webslicer-data:
```

**Updating:** `docker compose pull && docker compose up -d` (or `docker pull …` and a new `docker run`)
replaces the container; the `/data` volume keeps settings, printers and jobs, so nothing is lost. An
auto-updater such as Watchtower works with the same tags.

Without a published release yet, build the image as shown above; the release procedure is at
[Releasing an image](#releasing-an-image-maintainer).

### User and group ids (PUID/PGID)

The app never runs as root. Without configuration it starts as `node` (1000:1000), as before. NAS
systems manage their files by user and group id, so the container takes the ids to run as:

```bash
docker run -d --name webslicer -p 8080:8080 \
  -e PUID=99 -e PGID=100 \
  -v webslicer-data:/data -v /path/to/models:/library \
  ghcr.io/movieaddicted86/webslicer:latest
```

The entrypoint runs as root once, creates a matching user/group entry, hands the mounts over and then
starts the app as `99:100` (`docker top webslicer` shows it). **Set both ids** – a missing one falls
back to 1000, so `PUID=99` alone is not 99:100. `/data` is handed over recursively; `/library` only as
a directory, because a library on a NAS share can be huge – it has to be writable for the chosen ids
anyway (e.g. `chown 99:100 /mnt/user/models`), and the log warns when it is not.

The alternative, without root at all: `--user 99:100` starts the app directly as those ids; the mounts
must fit them (the entrypoint does nothing then).

#### Unraid

Add the container by hand (Docker → _Add Container_):

| Field      | Value                                                                       |
| ---------- | --------------------------------------------------------------------------- |
| Repository | `ghcr.io/movieaddicted86/webslicer:latest`                                  |
| Network    | bridge                                                                      |
| Port       | `8080` → container `8080`                                                   |
| Path       | `/mnt/user/appdata/webslicer` → `/data` (read/write)                        |
| Path       | your model share, e.g. `/mnt/user/models` → `/library` (read/write)         |
| Variable   | `PUID=99`                                                                   |
| Variable   | `PGID=100`                                                                  |
| Variable   | `WEBSLICER_UPDATE_CHECK=on` (or `off`, see [Update notice](#update-notice)) |

Optional variables (port, limits, `MCP_TOKEN`, `ALLOWED_HOSTS`) are in
[configuration.md](configuration.md). The app is then reachable at `http://<tower>:8080`; the first start
opens the _Printers_ dialog. An Unraid Community Applications template is not available yet.

On first start the _Printers_ dialog opens: pick vendor and printer model/nozzle (or create a _Custom
printer_). Then drag a model into the 3D view and click **Slice now**.

### Opening the app by IP, host name or reverse proxy

The API only answers requests that name this server: `/api` and `/mcp` refuse a `Host` that is not
`localhost`, a loopback address, an IP address, one of the machine's own interface addresses or a name
listed in `ALLOWED_HOSTS` (403 `host not allowed`). That closes **DNS rebinding** – a website that
points its own name at your LAN address could otherwise drive the whole API from the browser of
someone in the network. A browser `Origin` header (which only browsers send) has to name an allowed
host as well; API clients and MCP clients send none and are unaffected.

Practical cases:

- **`http://192.168.1.20:8080`** – works as before; an IP literal is always allowed (an attacker
  cannot aim a DNS name at an IP literal).
- **`http://webslicer.lan:8080`** or a NAS/LXC host name – add the name:
  `ALLOWED_HOSTS=webslicer.lan`. Ports in the list are allowed and ignored.
- **Behind a reverse proxy** (Caddy, nginx, Traefik) – either list the public name in
  `ALLOWED_HOSTS`, or make the proxy set the `Host` header to the address the app listens on
  (`proxy_set_header Host localhost:8080;` in nginx, `header_up Host {upstream_hostport}` in Caddy).
  If the proxy terminates TLS at another name, that name is the one to list.

Example with a custom PrusaSlicer version: `docker build --build-arg PRUSASLICER_VERSION=2.9.5 -t webslicer .`

### Where does the PrusaSlicer binary come from?

Prusa Research no longer publishes Linux binaries since 2.9.0 (Flatpak only). The image therefore uses
the maintained community AppImages built from the unmodified PrusaSlicer sources:

- x86_64: <https://github.com/gneiss15/PrusaSlicer.AppImage>
- arm64: <https://github.com/davidk/PrusaSlicer-ARM.AppImage>

With `PRUSASLICER_URL` any other AppImage (e.g. your own build) can be used; with `PRUSASLICER_BIN`
also a self-compiled binary mounted as a volume.

**Checksums.** The default AppImage of `PRUSASLICER_VERSION` is verified against a SHA-256 that is
pinned in `Dockerfile` and `proxmox/install.sh`; a mismatch aborts the build/install before the
archive is extracted. For a custom AppImage pass `PRUSASLICER_SHA256` (build arg for Docker, env
variable for the installer, persisted in `/etc/webslicer/installer.env`). Without it, a custom URL or
another version is downloaded unverified and the log says so.

**Licence.** The image contains PrusaSlicer (AGPL-3.0) as the engine; its source is at
<https://github.com/prusa3d/PrusaSlicer>, built as the tag `version_<PRUSASLICER_VERSION>`. WebSlicer
itself is AGPL-3.0-only. Both licence texts ship inside the image under
`/usr/share/doc/webslicer/` (`LICENSE`, `THIRD_PARTY_NOTICES.md`), and the labels of a release image
(`org.opencontainers.image.*`) name the sources, the version, the commit and the engine.

### Releasing an image (maintainer)

The workflow `.github/workflows/release-image.yml` publishes the image. It runs only on a pushed tag
`v*` and by manual start, never on a branch or a pull request.

**Once, in the repository settings:**

| Name                   | Type                | Value                                              |
| ---------------------- | ------------------- | -------------------------------------------------- |
| `DOCKERHUB_USERNAME`   | secret              | Docker Hub account name                            |
| `DOCKERHUB_TOKEN`      | secret              | an access token of that account (not the password) |
| `DOCKERHUB_REPOSITORY` | repository variable | `name/webslicer` – the namespace is not hard-coded |

GHCR needs no setting: the workflow pushes `ghcr.io/<owner>/webslicer` with its `GITHUB_TOKEN`
(`packages: write`). Without the three Docker Hub values the run still succeeds and publishes to GHCR
only, with a notice in the log and the job summary – so the workflow works before Docker Hub exists.

**Release:** bump the version (`npm run version:sync`), commit, then push a tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The workflow builds the amd64 image, starts it and checks `/api/health`, the slicer binary, the licence
files, the OCI labels and all three user-id modes (default, `PUID=99 PGID=100` and `--user 99:100`);
only then does it push. A failing smoke test means nothing is published. Tags: `<version>`, `latest`
and `sha-<commit>`. The image is amd64 only for now; the arm64 half is built on a native arm64 runner
in a later step.

**Dry run:** _Actions → Release image → Run workflow_ builds and smoke-tests everything, including the
publishing build, and pushes nothing (`publish` is off by default). The `tag` input only names the image
in that run; it does not build a different commit. Tick `publish` only to re-run a release that failed
after the push, and only from the tagged commit.

A tag can be re-run from _Actions_ → the run → _Re-run all jobs_; the workflow never deletes or
overwrites another version's tags.

## Update notice

A self-hosted WebSlicer tells you when the repository has moved on, but never updates itself. About a
minute after start and then once a day the **server** asks the GitHub REST API for the head of the
branch it was built from (`GIT_BRANCH`, default `main`) and for the newest release tag. If the head is
a different commit than `GIT_COMMIT` – or a newer tag than the running version exists – the top bar
shows a quiet, dismissible chip ("Update available · 3 commits behind" / "… · v1.1.0") that links to
the compare or release page; the About dialog shows the same line. Dismissing hides it for that
`latest` commit only, and a failure (no internet, GitHub unreachable, rate limit) is silent: the app
keeps the last answer and never blocks or interrupts anything. Nothing updates automatically.

The image has to know which commit it was built from; pass both build arguments:

```bash
docker build --build-arg GIT_COMMIT="$(git rev-parse HEAD)" --build-arg GIT_BRANCH=main -t webslicer .
# Compose reads them from the environment:
GIT_COMMIT="$(git rev-parse HEAD)" GIT_BRANCH=main docker compose build
```

Without the stamp (`unknown`, the default of a plain `docker build`) only new release tags are
noticed. The Proxmox installer derives both from its checkout and writes them into
`/etc/webslicer/webslicer.env`, so a native install compares commits as well.

**Privacy / opt-out:** the request goes from the server straight to `api.github.com`; it carries no
WebSlicer data – no model names, no settings, no user identity (GitHub sees the IP address and the
`User-Agent: webslicer`). Set `WEBSLICER_UPDATE_CHECK=off` (Docker `-e`, Compose `environment:`,
Proxmox `/etc/webslicer/webslicer.env`) to stop the check completely: no outbound request is made and
no notice appears. The default is on.

The same switch covers the **vendor profile check** (Printers dialog → Vendor profiles): with the
switch on, the server reads `raw.githubusercontent.com/prusa3d/PrusaSlicer-settings` at most once a
day for the installed vendors and downloads a bundle only when the user presses Update. With the
switch off, nothing is fetched and the dialog offers **Install from file** instead.

## Proxmox VE (LXC)

Run on the Proxmox host as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/movieaddicted86/webslicer/main/proxmox/webslicer-lxc.sh)"
```

The helper works like the community-scripts helpers: choose **Default settings** (2 cores, 3 GB RAM,
10 GB disk, DHCP, unprivileged, console autologin) or **Advanced settings** (OS version, container type,
root password, ID, hostname, disk, CPU, RAM, bridge, static IP/gateway, IPv6, VLAN, MTU, MAC, DNS,
SSH key, web port, a host directory as model library, PrusaSlicer version, tags, verbose output).
Storage pools are offered with their free space. The script downloads the Debian template, creates the
LXC, installs Node.js 22 and PrusaSlicer, builds WebSlicer and sets up the systemd service
`webslicer`; progress is shown step by step and the full output goes to a log file in `/tmp`. The URL
is printed at the end.

To update, type `update` in the container console (or `pct exec <id> -- update` on the host), or run
the helper command again inside the container.

**Updating from a pinned release instead of `main`.** By default an install follows the `main`
branch, so `update` picks up every new commit. To stay on a released state, set
`WEBSLICER_BRANCH` to a tag (or any branch/commit) before the install – the installer stores it in
`/etc/webslicer/installer.env` and `update` keeps using it:

```bash
WEBSLICER_BRANCH=v1.0.0-rc.2 bash proxmox/install.sh          # or the helper: … bash proxmox/webslicer-lxc.sh
# later, by hand in the container – `update` then keeps that tag:
sed -i 's/^WEBSLICER_BRANCH=.*/WEBSLICER_BRANCH=v1.0.0-rc.2/' /etc/webslicer/installer.env
```

The same variable is honoured by a local checkout (`WEBSLICER_BRANCH=… bash proxmox/webslicer-lxc.sh`).
The Docker image is pinned by its tag; build it from a release tag to keep it there.

**Model library from the host / NAS:** in the advanced settings you can bind-mount a host directory as
`/var/lib/webslicer/library`. In an unprivileged container WebSlicer runs as uid 101050 on the host, so
the directory must be writable for that uid (e.g. `chown 101050:101050 /mnt/pve/nas/3d`) if you want to
save projects and G-code there; reading works with normal read permissions.

Non-interactive (all variables optional):

```bash
YES=1 CTID=120 HOSTNAME_CT=webslicer DISK=12 CORES=4 RAM=4096 STORAGE=local-lvm IP=dhcp \
  LIBRARY_PATH=/mnt/pve/nas/3d bash proxmox/webslicer-lxc.sh
```

When run from a local checkout (e.g. copied to the host with `scp`), the local sources are pushed into
the container instead of being fetched from GitHub. Repository (`WEBSLICER_REPO`) and branch can be set
via environment variables.

Recommended resources: 2–4 cores, 3–4 GB RAM (large models need more), 10 GB disk (PrusaSlicer
extracts to ≈ 1 GB).

Useful commands inside the container:

```bash
update                               # update WebSlicer and PrusaSlicer
systemctl status webslicer
journalctl -u webslicer -f
```

The installer `proxmox/install.sh` also works on any Debian 12/13 or Ubuntu 22.04+ (VM, bare metal).

### Alternative: Docker inside the LXC

If you prefer Docker inside the LXC: create the container with `nesting=1`, install Docker and run
`docker compose up -d` in the repository.

## Configuration

Every environment variable – port, data and library directories, job limits, MCP token, allowed host
names – is in [configuration.md](configuration.md). On a Proxmox install they live in
`/etc/webslicer/webslicer.env`.
