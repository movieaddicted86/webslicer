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

# ---------- 1. Build frontend + backend ------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---------- 2. Fetch PrusaSlicer AppImage ----------------------------------
FROM debian:bookworm-slim AS slicer
ARG PRUSASLICER_VERSION
ARG PRUSASLICER_URL=
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
    echo "Downloading $URL"; \
    curl -fL --retry 3 -o PrusaSlicer.AppImage "$URL"; \
    chmod +x PrusaSlicer.AppImage; \
    ./PrusaSlicer.AppImage --appimage-extract >/dev/null; \
    mv squashfs-root prusaslicer; \
    rm PrusaSlicer.AppImage; \
    echo "${PRUSASLICER_VERSION}" > prusaslicer/VERSION

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
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    PRUSASLICER_BIN=/opt/prusaslicer/AppRun \
    WEB_DIST=/app/web/dist \
    HOME=/tmp

# Fail the build early if the slicer cannot start in this image.
RUN /opt/prusaslicer/AppRun --help | head -n 1 \
 && mkdir -p /data && chown -R node:node /data /app

USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://localhost:8080/api/health || exit 1
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/dist/index.js"]
