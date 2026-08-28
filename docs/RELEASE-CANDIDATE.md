# Rule1 release-candidate parity record

Date: 22 August 2026

Reviewed baseline: `link42-rule1` at `aaa140cdd753d6576f0a2bf3292b31518b88fbcc`

Canonical release target: [`rule1.link42.app`](https://rule1.link42.app/). The original 22 August release used the historical `wan0.net/rule1` path.

## Status and scope

The initial standalone application was published on GitHub Pages on 22 August 2026: the repository is public, Pages is enabled, and [workflow run 32555995535](https://github.com/wan0net/rule1/actions/runs/32555995535) succeeded. The repository has continued to change since that publication checkpoint.

This record distinguishes four states: source-complete means the change is present in the repository; CI-verified means a named workflow run passed; deployed means that verified artifact was published; live-verified means the deployed origin was checked after publication. A source or local test result is not evidence of the later states unless this document names that evidence.

Parity is assessed against the reviewed old desktop product and the route/capability dispositions in [REVIEW.md](REVIEW.md). Subsequent work added deliberate phone and tablet layouts, keyboard interaction, WCAG-oriented fixes, and rendered accessibility regression coverage without changing the retained desktop visual language.

## Route and capability matrix

| Built route | Release-candidate behaviour | Baseline disposition |
|---|---|---|
| `/` | Recognisable Rule1 landing and all five retained framework entry points; availability comes from local SQLite. | Retained |
| `/explorer/` | Hierarchy, search, filters, deep links, details, history, E8 maturity mappings, context graph, local favourites, and JSON/CSV/Markdown control exports. | Retained and reviewed |
| `/compare/` | Framework/version selection, refresh-safe state, change filtering, and formula-safe CSV export. | Retained and reviewed |
| `/glossary/` | Framework navigation, search, and term detail states work; ISM glossary terms and their retained OSCAL history are available locally. | Retained and reviewed |
| `/guide/` | Static standalone usage, data, and interpretation guidance. | Retained and corrected |
| `/privacy/` | Static, accurate browser-local privacy statement. | Retained and corrected |
| `/about/`, `/api/`, `/licence/` | Root-domain static destinations to the guide. `/api/` explicitly states that there is no runtime API. | Static compatibility routes |
| `/changelog/` | Root-domain static destination to version comparison. | Static compatibility route |
| `/bypass-eligibility/` | Root-domain static destination explaining that bypass tokens are excluded. | Removed server feature with compatibility route |
| Unknown route | Static `404.html` fallback with a root home link. | Retained |

The built route verifier checks every route above, the fallback, database, artifact manifest, and SQLite runtime assets. It also rejects the retired `/rule1/` deployment prefix and rendered links to the retired Rule1 API, account service, or old Rule1 host.

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
- Geist and Geist Mono are self-hosted from pinned, checksum-recorded official v1.7.1 WOFF2 files. The reviewed typography is restored without an external font request; system fonts remain fallbacks if local font loading fails.

Responsive phone/tablet behaviour and accessibility repairs are retained additions made after the initial desktop port. They do not restore authentication, operated services, or community-write features.

The shared, local UI package still contains dormant platform URL constants in its compiled JavaScript because the reviewed platform bar and footer are retained. They are not rendered as retired Rule1/account links and are not request targets. The only production `fetch` targets are same-origin SvelteKit version metadata, the SQLite module, the database artifact manifest, and the checksummed database. The static verifier requires the local font assets and rejects external Google Fonts requests.

## Current data and retained gaps

- The Australian ISM now ends at the authoritative `ISM-OSCAL-2026.06.18` catalog with 1,101 active controls and 49 cyber security principles. This closes the old candidate's December 2025 currency and missing-principles gaps.
- ISM OSCAL glossary history is retained from June 2022 onward; frameworks whose archived sources provide no glossary remain in an honest empty state.
- AI annotations from the operated product are not retained.
- The Essential Eight mapping rows retain maturity levels but contain no named strategy strings.
- The Cyber Essentials 3.2 source PDF is missing from the archive. Its committed, checksum-verified 3.2 JSON source is ingested.
- Australian ISM Excel history is not committed; ingestion uses 45 historical PDFs through March 2022 followed by 17 official ASD OSCAL catalogs covering the June 2022 through June 2026 editions.

These are provenance/data differences, not UI defects. Framework decisions should be checked against the current authoritative publisher source.

## Verification evidence

The following is a dated local source-verification checkpoint. It is not hosted-CI, deployment, or live-origin evidence. `pnpm verify` passed on 27 August 2026:

- Biome: 73 files checked.
- Svelte type checking: zero errors and zero warnings.
- Node script tests: 10 passed.
- Python ingestion/parser/database tests: 11 passed, including two clean byte-identical database builds, OSCAL metadata and original-parser parity, and June 2026 catalogue regressions.
- Web tests: 18 files and 160 tests passed.
- Browser tests: 2 passed across responsive, accessibility, loading, and local-only interaction coverage.
- Database build and validation passed locally; `build/rule1.sqlite3` has SHA-256 `5a1ad1752fc9f4f0e6914d64ddd4c358c7dd2fa34b91cc806c6250d1e1511ab7`.
- Static verifier: 11 routes plus the fallback passed at the root; no retired deployment prefix or operated-host link was found.

The current source-controlled release gate runs the same complete verification command for pull requests and `main`, performs a second deterministic database build, and permits only a verified `main` build to publish. Its post-deployment canary checks the current HTML-referenced immutable assets, the deployed artifact manifest, and the database bytes. These workflow controls describe repository source; a named completed workflow and canary are still required before claiming a new deployment is CI-verified or live-verified.

The canonical macOS local build SHA-256 is:

```text
5a1ad1752fc9f4f0e6914d64ddd4c358c7dd2fa34b91cc806c6250d1e1511ab7  build/rule1.sqlite3
5a1ad1752fc9f4f0e6914d64ddd4c358c7dd2fa34b91cc806c6250d1e1511ab7  apps/web/build/data/rule1.sqlite3
```

The current catalogue heads are `CE-3.3`, `ISM-OSCAL-2026.06.18`, `NZISM-3.9`, `NIST-CSF-2.0`, and `800-53-Rev-5.2.0`. Database integrity reports `ok`.

### Historical live-release verification

On 27 August 2026, before the Link42 organisation and domain migration, [GitHub Actions run 33039711058](https://github.com/wan0net/rule1/actions/runs/33039711058) completed the full build job, deterministic repeat build, Pages deployment, and post-deployment canary successfully. The canary verified 25 immutable assets and 65,613,824 deployed database bytes. The CI database SHA-256 was `a9e77655195a6000af511011144ca2dd6a6c4c859134f99abc0a4e62cabf4101`.

Independent cache-busted origin checks confirmed that current `app.DYuXl1GC.js` returned HTTP 200, the deleted redesign asset `app.DQeL95Q0.js` returned HTTP 404, and cache-busted Explorer HTML referenced the current application asset. This establishes the current hosted-CI, deployment, and origin state.

One persistent in-app browser profile still rendered obsolete redesign HTML from its disk cache. That client-local state does not change the verified origin status: no browser-local favourites, OPFS catalogue, or site data was cleared during verification, and a static origin cannot remotely erase an HTML document that a browser has already cached. Refreshing that profile's cached document remains an honest client-local gap.

### Initial live publication verification

The following immutable checksums and counts record the initial 22 August publication rather than the current rolling database:

- The GitHub Actions artifact and deployed database both have SHA-256 `b78e17b880f84db97d60f2f571366f333915fd83da19eeb31b6674f1a30f78d0`; the deployed artifact manifest has SHA-256 `347daff73e8503dbacb11b5c1ab2b5645bbf9ff74c4d6a83729b6bac0cf08d7d`.
- This Linux CI checksum is intentionally recorded separately from the macOS local checksum `d122eb5cb62260173d9a78826b7b746fde11147b2f49cedbeac9913f26641d9e`. Determinism is verified within each build environment; no unsupported cross-platform byte-identity claim is made.
- The live root, explorer, comparison, and artifact-manifest routes returned HTTP 200. The downloaded deployed database passed `PRAGMA integrity_check` with 77 catalogue versions, 79 source files, and 66,586 history rows.
- The current ISM contains 1,101 controls and 49 principles. `ISM-2116` is present as a new control, and browser verification covered its detail and history views.
- Browser comparison of March 2026 with June 2026 rendered 20 added, 122 modified, and 1,008 unchanged controls.

## Desktop visual comparison

The old landing, explorer, and long comparison references remain in `docs/reference/old-*.png`; the reviewed landing port reference is `docs/reference/port-feature3-landing-light.jpg`. Production-preview checks at 1265×890 passed for landing, explorer, and comparison across light and dark themes. Geist and Geist Mono are now served locally to restore the reviewed typography while preserving runtime independence. The current OSCAL production-preview check loaded 1,101 controls, opened June control `ISM-2116`, and rendered the March-to-June comparison from browser-local SQLite; ingestion regressions also confirm 49 principles, `ISM-2118`, and Essential Eight maturity mappings. The current shell preserves the old Rule1 hierarchy, compact control catalogue, blue accent, theme treatment, and detail layout. Detail and table content is denser because of the reviewed functional port. Explained differences are browser-local loading/empty/error notices, static-route notices, local favourites/exports, and the absence of operated-service affordances listed above.

## Publication outcome

- The initial Feature 13 public GitHub Pages deployment and its database were verified live at the publication checkpoint above.
- At that historical publication checkpoint, `rule1.link42.app` had not yet been moved to this static release.
