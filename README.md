# Rule1

Rule1 is a public, standalone security-controls catalogue. It lets people browse, search, compare, and inspect the retained history of the Australian ISM, New Zealand ISM, Cyber Essentials, NIST Cybersecurity Framework, and NIST SP 800-53.

The canonical site is [rule1.link42.app](https://rule1.link42.app/).

## How it works

Rule1 is a static SvelteKit application hosted on GitHub Pages. It downloads a checksum-verified SQLite snapshot, opens it inside the browser with SQLite WASM, and keeps a checksum-keyed local copy where the browser supports it. The snapshot also embeds reviewed factual and Professional descriptions for current Australian ISM controls; no model is called by the public application. There is no runtime application server, account system, or external database.

The [source repository](https://github.com/link42-au/rule1) is hosted by the [`link42-au`](https://github.com/link42-au) GitHub organisation. It contains the SvelteKit and TypeScript browser application, the Python ingestion pipeline, and the retained framework history used to generate the SQLite snapshot. GitHub Actions performs the same deterministic build and validation used locally, then publishes the verified static site to GitHub Pages at [rule1.link42.app](https://rule1.link42.app/).

The same verified `main` build is also published as a LinuxServer.io-based, multi-platform container at `ghcr.io/link42-au/rule1`. The image contains the complete static application and the exact SQLite catalogue produced by that workflow. Revision-specific `sha-<commit>` tags identify a release, immutable registry digests support exact deployment pins, and `latest` follows the newest successful `main` build. It supports LinuxServer.io's standard `PUID`, `PGID`, and `TZ` settings.

```bash
docker run --rm -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC -p 8080:80 ghcr.io/link42-au/rule1:latest
```

The GHCR package is currently private and requires registry authentication before it can be pulled. See [Container deployment](docs/CONTAINER-DEPLOYMENT.md) for Compose, authentication, reverse-proxy, update, rollback, and verification guidance.

## Feedback and support

- [Report a Rule1 bug](https://github.com/link42-au/rule1/issues/new?template=bug_report.yml) when the catalogue, interface, data, or documentation is not behaving as expected.
- [Suggest an improvement](https://github.com/link42-au/rule1/issues/new?template=feature_request.yml) for a new capability, usability change, framework addition, or documentation idea.
- Browse [existing issues](https://github.com/link42-au/rule1/issues) before opening a report to avoid duplicates.
- Report security vulnerabilities privately through [GitHub Security Advisories](https://github.com/link42-au/rule1/security/advisories/new). Do not put exploit details, secrets, personal information, or other sensitive material in a public issue.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the information that makes reports and pull requests easier to review.

## Development

Requirements:

- Node.js 22
- pnpm 10.15.1
- Python 3.12.13
- [uv](https://docs.astral.sh/uv/)

Install JavaScript dependencies:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

The Chromium install is a one-time local prerequisite for the responsive and accessibility regression suite.

Run the web application locally:

```sh
pnpm --filter @rule1/web dev
```

Run the complete test, ingestion, database-integrity, static-build, and browser verification:

```sh
pnpm verify
```

To prepare the real local SQLite snapshot and run only the browser regression suite, use `pnpm test:e2e:prepare`.

To build and validate only the SQLite snapshot:

```sh
pnpm build:database
pnpm validate:database
```

The canonical generated-description cache is `annotations/ism.json`; `annotations/legacy-preservation.json` records the immutable recovered-baseline digests. Of the 1,073 imported legacy pairs, generation preserves 936 unchanged current pairs and 3 historical pairs byte-for-byte, refreshes 134 stale pairs, and adds 73 current controls that were absent from the baseline. Normal pull-request and release builds consume those committed bytes without network inference. Maintainers can manually run the separate **Generate ISM annotations** workflow after configuring the masked `OPENROUTER_API_KEY` repository secret; it checkpoints generation, verifies complete current coverage, and opens or updates a review pull request. Deployment fails closed while any current ISM description is missing or stale.

## Sources and provenance

Framework source files used by ingestion are committed under `data/`. Their origin, version, date, and SHA-256 checksum are recorded in `data/source-ledger.json`. `pnpm validate:sources` verifies that archive before ingestion. Generated ISM descriptions are clearly identified as AI-generated in the interface, retained separately from authoritative framework sources, and recorded in database build metadata by cache checksum, prompt version, and model. See [docs/sources.md](docs/sources.md) for the retained source inventory and known gaps.

Rule1 is a navigation and change-review aid, not compliance advice. Check decisions against each publisher's authoritative framework.

## Licence

Rule1 code and project-authored documentation are licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.

Copyright © 2026 Iain Dickson.

Framework source documents and data retained under `data/` remain subject to their publishers' or source repositories' terms. They are included for provenance and reproducible ingestion and are **not relicensed** under the AGPL by this repository.

Third-party libraries retain their own licences. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/) for the audited dependency summary and licence texts.
