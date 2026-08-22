# Rule1 release-candidate parity record

Date: 22 August 2026

Reviewed baseline: `link42-rule1` at `aaa140cdd753d6576f0a2bf3292b31518b88fbcc`

Standalone candidate: private repository, GitHub Pages disabled

## Status and scope

The standalone application is source-complete and produces a static `/rule1/` build. Publication is deliberately not part of this release-candidate review: the repository remains private, the only workflow builds SQLite, and no Pages deployment workflow is present. Feature 13 remains blocked on separate publication approval.

Parity is assessed against the reviewed old desktop product and the route/capability dispositions in [REVIEW.md](REVIEW.md). Mobile-specific and accessibility work were explicitly excluded from this port.

## Route and capability matrix

| Built route | Release-candidate behaviour | Baseline disposition |
|---|---|---|
| `/rule1/` | Recognisable Rule1 landing and all five retained framework entry points; availability comes from local SQLite. | Retained |
| `/rule1/explorer/` | Hierarchy, search, filters, deep links, details, history, E8 maturity mappings, context graph, local favourites, and JSON/CSV/Markdown control exports. | Retained and reviewed |
| `/rule1/compare/` | Framework/version selection, refresh-safe state, change filtering, and formula-safe CSV export. | Retained and reviewed |
| `/rule1/glossary/` | Framework navigation, search, and term detail states work; the retained database currently contains no glossary rows. | Retained with explicit empty state |
| `/rule1/guide/` | Static standalone usage, data, and interpretation guidance. | Retained and corrected |
| `/rule1/privacy/` | Static, accurate browser-local privacy statement. | Retained and corrected |
| `/rule1/about/`, `/rule1/api/`, `/rule1/licence/` | Base-path-aware static destinations to the guide. `/api/` explicitly states that there is no runtime API. | Static compatibility routes |
| `/rule1/changelog/` | Base-path-aware static destination to version comparison. | Static compatibility route |
| `/rule1/bypass-eligibility/` | Base-path-aware static destination explaining that bypass tokens are excluded. | Removed server feature with compatibility route |
| Unknown route | Static `404.html` fallback with a `/rule1/` home link. | Retained |

The built route verifier checks every route above, the fallback, database, artifact manifest, and SQLite runtime assets. It also rejects rendered links or assets that escape the `/rule1/` base and rendered links to the retired Rule1 API, account service, or old Rule1 host.

## Confirmed defects fixed during the port

- Invalid initial frameworks now fall back to an available framework.
- Late control, history, mapping, graph, and comparison responses cannot overwrite newer selections.
- Clearing explorer, comparison, or glossary selections removes obsolete URL state.
- Glossary terms reload on framework changes and stale term details are cleared.
- Catalogue/statistics, empty, missing-control, and local-database failures have visible states.
- A first visit respects the operating-system theme when no valid local preference exists.
- Browser storage reads and writes recover from unavailable, malformed, or quota-full storage; a failed import does not destroy existing favourites.
- Explorer deep links expand only the selected control's ancestor groups instead of rendering every top-level control group.
- The release audit removed a rendered footer link back to `rule1.link42.app`; the standalone route is now used consistently.

Each state or race fix has a focused regression test in the explorer, catalogue, theme/foundation, local-user, or static route suites.

## Intentional differences from the operated product

- Data is fetched only as same-origin static assets and queried in a browser worker. There is no D1, Cloudflare Worker, DigitalOcean service, or runtime Rule1 API.
- There is no authentication, account cookie, cloud favourite sync, community write/vote path, bypass token, or maintenance polling.
- Favourites and preferences are browser-local. Favourite import/export remains available without an account.
- Control export supports JSON, formula-safe CSV, and escaped Markdown. XLSX is intentionally omitted rather than adding a spreadsheet dependency solely for parity.
- `/about`, `/api`, `/changelog`, `/licence`, and `/bypass-eligibility` are static compatibility destinations rather than server redirects.
- AI-generated annotations and summaries are absent; the application does not fabricate them.
- The old Google Fonts request is removed for runtime independence. Existing system sans-serif and monospace fallbacks preserve the compact desktop layout without a third-party font request.
- Mobile-specific and accessibility parity were outside the approved desktop scope.

The shared, local UI package still contains dormant platform URL constants in its compiled JavaScript because the reviewed platform bar and footer are retained. They are not rendered as retired Rule1/account links and are not request targets. The only production `fetch` targets are same-origin SvelteKit version metadata, the SQLite module, the database artifact manifest, and the checksummed database. The static verifier rejects external Google Fonts requests.

## Known retained-data gaps

- The retained Australian ISM ends at `ISM-PDF-2025-12`; the old live installation reports `2026.6.1`.
- The retained current ISM has no ISM principle records. The latest retained ISM has 1,079 rows, of which 1,073 are active controls and six are withdrawn.
- `term_history` is empty, so the glossary is an honest empty state for every framework.
- AI annotations from the operated product are not retained.
- The 2,325 Essential Eight mapping rows retain maturity levels but contain no named strategy strings.
- The Cyber Essentials 3.2 source PDF is missing from the archive. Its committed, checksum-verified 3.2 JSON source is ingested.
- Modern Australian ISM OSCAL and Excel files are not committed; ingestion uses the 58 retained PDFs through December 2025.

These are provenance/data differences, not UI defects. Framework decisions should be checked against the current authoritative publisher source.

## Verification evidence

`pnpm verify` passed on 22 August 2026:

- Biome: 58 files checked.
- Svelte type checking: zero errors and zero warnings.
- Node script tests: 6 passed.
- Python ingestion/parser/database tests: 6 passed, including two clean byte-identical database builds.
- Web tests: 11 files and 74 tests passed.
- Database validation: provenance, checksums, expected schema, 75 catalogue versions, 77 source files, recorded row counts, and `PRAGMA integrity_check` passed.
- Static production build: 11 routes plus `404.html` generated beneath `/rule1/`; no rendered root-path escape or retired operated-host link was found.
- Workflow audit: `.github/workflows/build-sqlite.yml` is the only workflow and has no Pages permission, environment, upload, or deployment step.

Canonical local database SHA-256:

```text
b1fc9ffc367da2948585289e55c4d6def06d5bb984b03ecdb2ef170ee8b2bacb  build/rule1.sqlite3
b1fc9ffc367da2948585289e55c4d6def06d5bb984b03ecdb2ef170ee8b2bacb  apps/web/build/data/rule1.sqlite3
```

The current catalogue heads are `CE-3.3`, `ISM-PDF-2025-12`, `NZISM-3.9`, `NIST-CSF-2.0`, and `800-53-Rev-5.2.0`. Database integrity reports `ok`.

## Desktop visual comparison

The old landing, explorer, and long comparison references remain in `docs/reference/old-*.png`; the reviewed landing port reference is `docs/reference/port-feature3-landing-light.jpg`. Production-preview checks at 1265×890 passed for landing, explorer, and comparison across light and dark themes. Post-font-removal smoke confirmed that the system fallbacks retain the reviewed shell and layout. Explorer deep-link smoke loaded `ism-0009` from local SQLite with 1,073 active controls; comparison rendered all 203 changes from ISM 2025-09 to 2025-12 and retained its canonical URL in dark mode. The current shell preserves the old Rule1 hierarchy, compact control catalogue, blue accent, theme treatment, and detail layout. Detail and table content is denser because of the reviewed functional port. Explained differences are system fallback typography, browser-local loading/empty/error notices, static-route notices, local favourites/exports, and the absence of operated-service affordances listed above.

## Remaining release gates

- Publication, repository visibility, GitHub Pages enablement, and the `wan0.net/rule1` deployment require separate explicit approval under Feature 13.
- Replacing the old installation requires an explicit decision to accept the December 2025 ISM gap or to add and validate newer authoritative ISM sources first.
- `rule1.link42.app` is not changed by this work.
