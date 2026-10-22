# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# WebSlicer – web frontend + API around the PrusaSlicer slicing engine (CLI)
#
# Prusa Research no longer publishes Linux binaries (only Flatpak) since 2.9.0,
# so the image uses community-maintained AppImage builds of the unmodified
# PrusaSlicer sources:
#   x86_64: https://github.com/gneiss15/PrusaSlicer.AppImage
#   arm64 : https://github.com/davidk/PrusaSlicer-ARM.AppImage
# Override PRUSASLICER_URL to use any other AppImage (e.g. your own build).
# ---------------------------------------------------------------------------

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PRUSASLICER_VERSION=2.9.6
ARG DEFAULT_PRUSASLICER_VERSION=2.9.6
# SHA-256 of the default AppImage of DEFAULT_PRUSASLICER_VERSION, per architecture (S4). The
# download is verified before it is extracted; a mismatch aborts the build. A custom
# PRUSASLICER_URL or PRUSASLICER_VERSION needs PRUSASLICER_SHA256; without it the build warns.
ARG PRUSASLICER_SHA256_AMD64=903765126127d99144f06bbac58857d4cc684d9b30c2884a4cc7e2ecb7a7fab8
ARG PRUSASLICER_SHA256_ARM64=8c4fa98ad9b07878b3ebfbb7e2ccdfd1bdf6fa307b87ba74dde3d07b4103b19a

# ---------- 1. Build frontend + backend ------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
# `npm run build` builds `shared` first (its `dist` is what the server and the runtime consume)
RUN npm run build \
 && npm prune --omit=dev

# ---------- 2. Fetch PrusaSlicer AppImage ----------------------------------
FROM debian:bookworm-slim AS slicer
ARG PRUSASLICER_VERSION
ARG DEFAULT_PRUSASLICER_VERSION
ARG PRUSASLICER_URL=
ARG PRUSASLICER_SHA256=
ARG PRUSASLICER_SHA256_AMD64
ARG PRUSASLICER_SHA256_ARM64
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN set -eux; \
    URL="${PRUSASLICER_URL}"; \
    if [ -z "$URL" ]; then \
      case "${TARGETARCH:-amd64}" in \
        amd64) URL="https://github.com/gneiss15/PrusaSlicer.AppImage/releases/download/${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-x86_64_GN.AppImage" ;; \
        arm64) URL="https://github.com/davidk/PrusaSlicer-ARM.AppImage/releases/download/version_${PRUSASLICER_VERSION}/PrusaSlicer-${PRUSASLICER_VERSION}-aarch64-full.AppImage" ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
      esac; \
    fi; \
    # S4: only the pinned default download is trusted without a user-supplied hash
    if [ -n "$PRUSASLICER_SHA256" ]; then \
      SHA="$PRUSASLICER_SHA256"; \
    elif [ -z "$PRUSASLICER_URL" ] && [ "$PRUSASLICER_VERSION" = "$DEFAULT_PRUSASLICER_VERSION" ]; then \
      case "${TARGETARCH:-amd64}" in \
        amd64) SHA="${PRUSASLICER_SHA256_AMD64}" ;; \
        arm64) SHA="${PRUSASLICER_SHA256_ARM64}" ;; \
      esac; \
    else \
      SHA=""; \
      echo "WARNING: AppImage download without PRUSASLICER_SHA256 – it is not verified" >&2; \
    fi; \
    echo "Downloading $URL"; \
    curl -fL --retry 3 -o PrusaSlicer.AppImage "$URL"; \
    if [ -n "$SHA" ]; then \
      echo "${SHA}  PrusaSlicer.AppImage" | sha256sum -c - || { echo "PrusaSlicer checksum mismatch – aborting"; exit 1; }; \
    fi; \
    chmod +x PrusaSlicer.AppImage; \
    ./PrusaSlicer.AppImage --appimage-extract >/dev/null; \
    mv squashfs-root prusaslicer; \
    rm PrusaSlicer.AppImage; \
    echo "${PRUSASLICER_VERSION}" > prusaslicer/VERSION; \
    # GUI-only resources are not needed for CLI slicing (≈ 100 MB)
    R=prusaslicer/usr/resources; \
    rm -rf "$R/localization" "$R/fonts" "$R/shapes" "$R/icons" "$R/workflows" "$R/web" "$R/applications" "$R/udev" \
           "$R/data/printer_gantries" prusaslicer/usr/share/locale; \
    du -sh prusaslicer

# ---------- 3. Runtime ------------------------------------------------------
FROM ${NODE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

COPY --from=slicer /opt/prusaslicer /opt/prusaslicer
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY samples/*.stl ./samples/

ENV NODE_ENV=production \
    WEBSLICER_VERSION=1.0.0-rc.2 \
    PORT=8080 \
    DATA_DIR=/data \
    PRUSASLICER_BIN=/opt/prusaslicer/AppRun \
    WEB_DIST=/app/web/dist \
    HOME=/tmp

# Fail the build early if the slicer cannot start in this image.
RUN /opt/prusaslicer/AppRun --help | head -n 1 \
 && mkdir -p /data /library && chown -R node:node /data /library /app

ENV LIBRARY_DIR=/library
USER node
VOLUME ["/data", "/library"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:8080/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
