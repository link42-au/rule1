# Third-party notices

Rule1 is licensed under AGPL-3.0-or-later, but its third-party dependencies retain their own licences. The dependency tree was audited from the locked JavaScript and Python environments on 25 August 2026. The licences present were MIT, Apache-2.0, ISC, BSD-3-Clause, `MIT OR Apache-2.0`, and AGPL-3.0 (PyMuPDF). These licences are compatible with distributing Rule1 under AGPL-3.0-or-later.

## Code shipped to browsers

- **Geist and Geist Mono v1.7.1** — SIL Open Font License 1.1. Copyright 2024 The Geist Project Authors. Rule1 retains the unmodified variable WOFF2 files from the [official Vercel Geist release](https://github.com/vercel/geist-font/releases/tag/v1.7.1), with exact source URLs and SHA-256 checksums recorded beside the font assets. The [OFL text](LICENSES/OFL-1.1-Geist.txt) is also shipped with the static site.
- **@sqlite.org/sqlite-wasm 3.53.0-build1** — Apache-2.0. The static distribution includes [the Apache-2.0 text](LICENSES/Apache-2.0.txt) beside the SQLite WASM assets.
- **Svelte 5.56.8** — MIT. Copyright (c) 2016-2025 [Svelte Contributors](https://github.com/sveltejs/svelte/graphs/contributors).
- **SvelteKit 2.58.0** — MIT. Copyright (c) 2020 [these people](https://github.com/sveltejs/kit/graphs/contributors).

The complete MIT permission and warranty text is retained in [LICENSES/MIT.txt](LICENSES/MIT.txt). Transitive browser code is covered by the same permissive licence families recorded above; exact versions are pinned in `pnpm-lock.yaml`.

## Build and ingestion tooling

- **PyMuPDF 1.26.4** — GNU Affero GPL 3.0 or a commercial Artifex licence. Rule1 uses it only in the ingestion pipeline; it is not shipped to browsers. Rule1 uses it under the AGPL option.
- Node.js development, test, and build dependencies use MIT, Apache-2.0, ISC, BSD-3-Clause, or `MIT OR Apache-2.0`. They are pinned in `pnpm-lock.yaml` and are not direct runtime components of the published site.

This file is a concise notice, not a substitute for the dependency packages' own licence files. The font binaries remain under the SIL OFL 1.1 and are not relicensed under Rule1's AGPL licence. Framework documents under `data/` are source material rather than software dependencies and remain subject to their publishers' terms, as described in the README.
