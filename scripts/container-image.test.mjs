import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

test("container image follows LinuxServer.io conventions and embeds the verified static build", () => {
  const dockerfile = readFileSync(new URL("Dockerfile", ROOT), "utf8");
  const dockerignore = readFileSync(new URL(".dockerignore", ROOT), "utf8");

  assert.match(dockerfile, /^FROM lscr\.io\/linuxserver\/nginx:latest@sha256:[a-f0-9]{64}$/m);
  assert.match(dockerfile, /build_version="Rule1 version:- \$\{VERSION\} Build-date:- \$\{BUILD_DATE\}"/);
  assert.match(dockerfile, /COPY deploy\/container\/root\/ \/$/m);
  assert.match(dockerfile, /COPY apps\/web\/build\/ \/app\/www\/public\//);
  assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{VCS_REF\}"/);
  assert.match(dockerfile, /^EXPOSE 80$/m);
  assert.doesNotMatch(dockerfile, /^USER /m);
  assert.doesNotMatch(dockerfile, /pnpm|uv run|apt-get/);

  assert.match(dockerignore, /^\*\*$/m);
  assert.match(dockerignore, /^!apps\/web\/build\/\*\*$/m);
  assert.match(dockerignore, /^!deploy\/container\/root\/\*\*$/m);
});

test("container server prevents stale database releases and caches immutable assets", () => {
  const config = readFileSync(
    new URL("deploy/container/root/defaults/nginx/site-confs/default.conf.sample", ROOT),
    "utf8",
  );

  assert.match(config, /listen 80 default_server;/);
  assert.match(config, /root \/app\/www\/public;/);
  assert.match(config, /location = \/data\/rule1-artifact-manifest\.json[\s\S]*no-cache, no-store, must-revalidate/);
  assert.match(config, /location = \/data\/rule1\.sqlite3[\s\S]*Cache-Control "no-cache"/);
  assert.match(config, /location \/_app\/immutable\/[\s\S]*max-age=31536000, immutable/);
  assert.match(config, /try_files \$uri \$uri\/ =404;/);
  assert.match(config, /error_page 404 \/404\.html;/);
});
