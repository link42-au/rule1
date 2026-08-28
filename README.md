# Rule1

Rule1 is a public, standalone security-controls catalogue. It lets people browse, search, compare, and inspect the retained history of the Australian ISM, New Zealand ISM, Cyber Essentials, NIST Cybersecurity Framework, and NIST SP 800-53.

The canonical site is [rule1.link42.app](https://rule1.link42.app/).

## How it works

Rule1 is a static SvelteKit application hosted on GitHub Pages. It downloads a checksum-verified SQLite snapshot, opens it inside the browser with SQLite WASM, and keeps a checksum-keyed local copy where the browser supports it. There is no runtime application server, account system, or external database.

The [source repository](https://github.com/link42-au/rule1) is hosted by the [`link42-au`](https://github.com/link42-au) GitHub organisation. It contains the SvelteKit and TypeScript browser application, the Python ingestion pipeline, and the retained framework history used to generate the SQLite snapshot. GitHub Actions performs the same deterministic build and validation used locally, then publishes the verified static site to GitHub Pages at [rule1.link42.app](https://rule1.link42.app/).

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

## Sources and provenance

Framework source files used by ingestion are committed under `data/`. Their origin, version, date, and SHA-256 checksum are recorded in `data/source-ledger.json`. `pnpm validate:sources` verifies that archive before ingestion. See [docs/sources.md](docs/sources.md) for the retained source inventory and known gaps.

Rule1 is a navigation and change-review aid, not compliance advice. Check decisions against each publisher's authoritative framework.

## Licence

Rule1 code and project-authored documentation are licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), identified by the SPDX expression `AGPL-3.0-or-later`.

Copyright © 2026 Iain Dickson.

Framework source documents and data retained under `data/` remain subject to their publishers' or source repositories' terms. They are included for provenance and reproducible ingestion and are **not relicensed** under the AGPL by this repository.

Third-party libraries retain their own licences. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/](LICENSES/) for the audited dependency summary and licence texts.
