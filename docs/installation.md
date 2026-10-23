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
