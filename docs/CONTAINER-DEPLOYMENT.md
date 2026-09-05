# Rule1 container deployment

Rule1 is published in two forms from the same verified build: the canonical GitHub Pages site and a self-hostable container image. The container does not introduce an API or server-side database. Nginx serves the static SvelteKit application, SQLite WASM runtime, release manifest, and read-only SQLite catalogue; each browser still downloads and queries the catalogue locally.

## Published image

The image is published to:

```text
ghcr.io/link42-au/rule1
```

GitHub Container Registry currently reports the package as private. Authenticate before pulling it with a GitHub token that can read packages. Keep the token in the deployment system's secret store and never commit it to this repository or a Compose file.

```sh
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username YOUR_GITHUB_USER --password-stdin
```

Two tag forms are published after each successful `main` build:

- `latest` follows the newest verified `main` image and is convenient for update-aware deployments.
- `sha-<full-commit>` identifies the source revision and is the convenient human-readable release tag.

Container tags are pointers and are not registry-enforced immutable. For an exact production or rollback pin, use the published multi-platform index digest:

```text
ghcr.io/link42-au/rule1@sha256:<index-digest>
```

The image index contains `linux/amd64` and `linux/arm64`. Docker selects the matching platform automatically.

## Verified-build boundary

The `Build SQLite` workflow is the only publication path. It performs these operations in order:

1. Validate the committed source archive and run `pnpm verify`.
2. Rebuild SQLite and require a byte-identical repeat build in the Linux runner environment.
3. Build a local container and run the existing deployed-release canary against it.
4. Check the current ISM annotation completeness gate.
5. Upload the exact verified static build as a short-lived workflow artifact.
6. Deploy that build to GitHub Pages and build the GHCR image from the same artifact.

Pull requests run the verification and container smoke test but cannot publish. On `main`, the workflow starts automatically only when a deployable input changes: catalogue data, ingestion or annotations, the web application, runtime packages and locks, database/static build scripts, container files, or the release workflow itself. Documentation-only and test-only pushes do not rebuild SQLite, deploy Pages, or publish a container. `workflow_dispatch` remains the explicit way to force a verified release from `main`.

A successful eligible push or manual run publishes both `latest` and the commit tag. A failed verification leaves the previous GHCR tags unchanged. This is a release-trigger boundary rather than an attempt to infer whether two generated databases would be byte-identical after the job has started.

The SQLite bytes are architecture-independent and are built once. The AMD64 and ARM64 runtime images receive the same verified static directory rather than generating separate databases under emulation.

## LinuxServer.io runtime contract

The runtime is derived from the multi-architecture `lscr.io/linuxserver/nginx` image and follows its s6 and user-mapping conventions. The LinuxServer.io base is pinned by digest in `Dockerfile`; refreshing that base is an explicit source change and does not happen merely because its upstream `latest` tag moves.

Runtime settings:

| Setting | Contract |
|---|---|
| HTTP port | Container port `80` |
| Web root | `/app/www/public` |
| `PUID` / `PGID` | Maps LinuxServer.io's `abc` service account to the chosen host identity |
| `TZ` | Selects the container timezone |
| `/config` | Optional LinuxServer.io configuration state; it does not contain the embedded application or database |
| Health check | Requests `http://127.0.0.1:80/` inside the container |

The image-owned web root is deliberate. Do not mount a host directory over `/app/www/public`, `/app/www/public/data`, or the SQLite path: doing so replaces the application or breaks the guarantee that the manifest and database came from the same verified build.

The supplied Nginx default prevents stale release metadata by serving the database manifest with `no-store` and the database with `no-cache`. Content-hashed SvelteKit assets are cached as immutable. Custom files retained in a mounted `/config` can override the supplied Nginx defaults, so review old configuration before reusing a volume with a newer image.

See the [LinuxServer.io Nginx documentation](https://docs.linuxserver.io/images/docker-nginx/) for its standard environment, `/config`, and read-only-filesystem behavior.

## Docker Compose

This minimal Compose deployment exposes Rule1 on host port `8080`:

```yaml
services:
  rule1:
    image: ghcr.io/link42-au/rule1:latest
    container_name: rule1
    environment:
      PUID: "1000"
      PGID: "1000"
      TZ: Australia/Sydney
    ports:
      - "8080:80"
    restart: unless-stopped
```

No application-data volume, database service, migration, or writable catalogue directory is required. Browser-local favourites and the verified OPFS catalogue cache remain inside each user's browser and are not stored in the container.

For a reverse-proxy deployment, route HTTP to container port `80` and terminate TLS at the proxy. Do not expose the container's port directly when the proxy already provides ingress. Preserve normal `GET`, `HEAD`, content-length, and byte-serving behavior for the SQLite download.

## Updating

Publishing a new image does not recreate a running container. Documentation and test-only changes publish nothing, while eligible application or catalogue changes move `latest` only after the full gate succeeds. Deployment automation must then pull and recreate it:

```sh
docker compose pull rule1
docker compose up -d --no-deps rule1
```

After recreation, wait for the container health check and verify the manifest from the deployed origin:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/data/rule1-artifact-manifest.json | jq .
```

For controlled production updates, inspect the new `sha-<full-commit>` tag after CI succeeds, record its multi-platform index digest, update the Compose image reference to that digest, and recreate the service. This pins the exact application and database bytes rather than allowing an unnoticed tag change.

## Rollback

Rollback is image-based. Change the Compose reference to the previous known-good index digest, pull it, and recreate the service. The previous image contains its own matching manifest and database; do not copy database files between image revisions. Keep the corresponding commit tag in the deployment record for human traceability.

Browsers preserve checksum-keyed catalogue copies transactionally. When a rollback serves an older manifest, the client validates those bytes independently and does not mix files from different releases.

## Local build and verification

The Docker build consumes `apps/web/build`, which is generated and ignored by Git. Prepare and validate it first:

```sh
pnpm verify
docker build \
  --build-arg VERSION="$(git rev-parse HEAD)" \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --tag rule1:local \
  .
docker run --rm -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC -p 8080:80 rule1:local
```

In another terminal, verify the running container with the repository canary:

```sh
node scripts/post-deploy-canary.mjs \
  http://127.0.0.1:8080/ \
  apps/web/build/data/rule1-artifact-manifest.json
```

## Current publication evidence

Feature 46 was published from commit `cc58c8be55dc8399b4b366f36e44057c103e68f0` by [GitHub Actions run 33932765951](https://github.com/link42-au/rule1/actions/runs/33932765951). Its `build-sqlite`, `deploy-pages`, and `publish-container` jobs all completed successfully.

The published image index digest was `sha256:2c3e6f7684e64373dbeaccbc9568a6f5543e03369f6919ee858b47b7105cea47`, with AMD64 and ARM64 manifests. Pulling the revision-specific commit tag and reading the served database produced SHA-256 `039f02af124b14e35d1c9987ce64cd6addd11c7822bf29de307b0991bf8bf406`, matching the manifest embedded in that image. These values record that release only; use the current workflow run and image manifest for later releases.
