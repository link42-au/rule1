# syntax=docker/dockerfile:1.7

FROM lscr.io/linuxserver/nginx:latest@sha256:d210d91a5033912ad8604514584fd9b6436f04e811e5b69268ff7b20d300773c

ARG BUILD_DATE=unknown
ARG VERSION=unknown
ARG VCS_REF=unknown

LABEL build_version="Rule1 version:- ${VERSION} Build-date:- ${BUILD_DATE}" \
      maintainer="link42-au" \
      org.opencontainers.image.title="Rule1" \
      org.opencontainers.image.description="Rule1 static web application with its verified browser-local SQLite catalogue" \
      org.opencontainers.image.source="https://github.com/link42-au/rule1" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.revision="${VCS_REF}"

RUN printf "Rule1 version: %s\nBuild-date: %s\n" "${VERSION}" "${BUILD_DATE}" > /build_version

COPY deploy/container/root/ /
COPY apps/web/build/ /app/www/public/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:80/ >/dev/null || exit 1
