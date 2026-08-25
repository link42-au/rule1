# Rule1

Rule1 is a public, standalone security-controls catalogue. It lets people browse, search, compare, and inspect the retained history of the Australian ISM, New Zealand ISM, Cyber Essentials, NIST Cybersecurity Framework, and NIST SP 800-53.

The live site is [wan0.net/rule1](https://wan0.net/rule1/).

## How it works

Rule1 is a static SvelteKit application hosted on GitHub Pages. It downloads a checksum-verified SQLite snapshot, opens it inside the browser with SQLite WASM, and keeps a checksum-keyed local copy where the browser supports it. There is no runtime application server, account system, or external database.

The repository contains the ingestion pipeline and retained framework history used to generate the SQLite snapshot. GitHub Actions performs the same build and validation used locally.

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

## Sources and provenance

Framework source files used by ingestion are committed under `data/`. Their origin, version, date, and SHA-256 checksum are recorded in `data/source-ledger.json`. `pnpm validate:sources` verifies that archive before ingestion. See [docs/sources.md](docs/sources.md) for the retained source inventory and known gaps.

Rule1 is a navigation and change-review aid, not compliance advice. Check decisions against each publisher's authoritative framework.

## Licence

Rule1 code and project-authored documentation are licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.

Copyright © 2026 Iain Dickson.

Framework source documents and data retained under `data/` remain subject to their publishers' or source repositories' terms. They are included for provenance and reproducible ingestion and are **not relicensed** under the AGPL by this repository.

Third-party libraries retain their own licences. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/) for the audited dependency summary and licence texts.
