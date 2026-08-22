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

## Current data and retained gaps

- The Australian ISM now ends at the authoritative `ISM-OSCAL-2026.06.18` catalog with 1,101 active controls and 49 cyber security principles. This closes the old candidate's December 2025 currency and missing-principles gaps.
- `term_history` is empty, so the glossary is an honest empty state for every framework.
- AI annotations from the operated product are not retained.
- The Essential Eight mapping rows retain maturity levels but contain no named strategy strings.
- The Cyber Essentials 3.2 source PDF is missing from the archive. Its committed, checksum-verified 3.2 JSON source is ingested.
- Australian ISM Excel history is not committed; ingestion uses 58 historical PDFs followed by the official March and June 2026 OSCAL catalogs.

These are provenance/data differences, not UI defects. Framework decisions should be checked against the current authoritative publisher source.

## Verification evidence

`pnpm verify` passed on 22 August 2026:

- Biome: 58 files checked.
- Svelte type checking: zero errors and zero warnings.
- Node script tests: 6 passed.
- Python ingestion/parser/database tests: 9 passed, including two clean byte-identical database builds, OSCAL metadata checks, and June 2026 catalogue regressions.
- Web tests: 11 files and 74 tests passed.
- Database validation: provenance, checksums, expected schema, 77 catalogue versions, 79 source files, recorded row counts, and `PRAGMA integrity_check` passed.
- Static production build: 11 routes plus `404.html` generated beneath `/rule1/`; no rendered root-path escape or retired operated-host link was found.
- Workflow audit: `.github/workflows/build-sqlite.yml` is the only workflow and has no Pages permission, environment, upload, or deployment step.

Canonical local database SHA-256:

```text
d122eb5cb62260173d9a78826b7b746fde11147b2f49cedbeac9913f26641d9e  build/rule1.sqlite3
d122eb5cb62260173d9a78826b7b746fde11147b2f49cedbeac9913f26641d9e  apps/web/build/data/rule1.sqlite3
```

The current catalogue heads are `CE-3.3`, `ISM-OSCAL-2026.06.18`, `NZISM-3.9`, `NIST-CSF-2.0`, and `800-53-Rev-5.2.0`. Database integrity reports `ok`.

## Desktop visual comparison

The old landing, explorer, and long comparison references remain in `docs/reference/old-*.png`; the reviewed landing port reference is `docs/reference/port-feature3-landing-light.jpg`. Production-preview checks at 1265×890 passed for landing, explorer, and comparison across light and dark themes. Post-font-removal smoke confirmed that the system fallbacks retain the reviewed shell and layout. The current OSCAL production-preview check loaded 1,101 controls, opened June control `ISM-2116`, and rendered all 166 March-to-June changes from browser-local SQLite; ingestion regressions also confirm 49 principles, `ISM-2118`, and Essential Eight maturity mappings. The current shell preserves the old Rule1 hierarchy, compact control catalogue, blue accent, theme treatment, and detail layout. Detail and table content is denser because of the reviewed functional port. Explained differences are system fallback typography, browser-local loading/empty/error notices, static-route notices, local favourites/exports, and the absence of operated-service affordances listed above.

## Remaining release gates

- Publication, repository visibility, GitHub Pages enablement, and the `wan0.net/rule1` deployment require separate explicit approval under Feature 13.
- `rule1.link42.app` is not changed by this work.
