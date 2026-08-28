# Rule1 port review

## Baseline

- Source: the old Link42 Rule1 at `aaa140cdd753d6576f0a2bf3292b31518b88fbcc`.
- Visual references: [landing](reference/old-landing.png), [explorer](reference/old-explorer.png), and [compare](reference/old-compare.png).
- These references define the recognisable desktop product, not a requirement to preserve defects or internal architecture.

## Route and capability disposition

| Route or capability | Disposition |
|---|---|
| `/` | Port and review the landing page and product identity. |
| `/explorer` | Port the hierarchy, search, filters, control detail, history, mappings, graph, and local favourites; fix the confirmed state bugs below. |
| `/compare` | Port comparison and export behaviour; prevent stale responses from replacing the current selection. |
| `/glossary` | Port glossary navigation and search; reload terms when the framework changes. |
| `/guide` | Port as static content. |
| `/privacy` | Port, correcting claims that depend on retired services. |
| `/about`, `/api`, `/changelog`, `/licence` | Preserve their user-facing destination with static-compatible routes or redirects. |
| `/bypass-eligibility` | Remove or redirect because bypass tokens are excluded. |
| Error/not-found page | Port for the static base path. |
| Local favourites and import/export | Retain in browser storage with guarded, recoverable writes. |
| Authentication and cloud favourites | Exclude; no operated identity or sync service. |
| Community writes and voting | Exclude; no write backend. |
| Bypass tokens and maintenance polling | Exclude; they are server operations. |

## Confirmed frontend defects

Each fix requires a regression test; none is a design change.

- An invalid framework in the initial URL is accepted instead of falling back safely.
- Earlier detail or comparison requests can finish late and overwrite newer state.
- Glossary terms are not reloaded when the selected framework changes.
- Cleared selections can leave stale state in the URL.
- Statistics failures are swallowed, leaving no explicit error state.
- A first visit is forced to light theme instead of respecting the user's system preference.
- Favourite persistence writes are unguarded and can fail noisily when storage is unavailable or full.

## Port seams

- Bring the required shared UI and design tokens into this repository; retain no monorepo package dependency.
- Convert server routes, redirects, base-path handling, and theme persistence for the original static `/rule1/` project-path build. Feature 38 later moved the current build to the `rule1.link42.app` root.
- Put a typed browser SQLite client between the reviewed UI and the database. Pages should consume domain data, not backend-specific HTTP plumbing.

The minimal read contract covers the old data-backed UI operations corresponding to:

- `frameworks`, `stats`, and `versions`
- `guidelines`, `principles`, `sections`, and `groups`
- `controls`, control detail, history, and graph
- `compare`
- `terms` and term detail

Authentication, favourites sync, community, health, bypass, caching, and maintenance endpoints are not part of the local data contract.

## SQLite build boundary

GitHub Actions will generate one deterministic SQLite artifact from committed sources. Validation is deliberately limited to provenance, source checksums, expected schema, framework/version coverage, recorded row counts, and `PRAGMA integrity_check`. Signing, attestations, evidence bundles, and release-policy machinery are out of scope.

## Reference verification

- Frontend: 72 tests passed.
- API: 33 tests passed.
- Python ingestion tests were not run because `pytest` was unavailable in the reference environment.
- The shared UI package emits a Svelte package-exports warning; address it when making the shared UI local, without using it as a reason to redesign the interface.
