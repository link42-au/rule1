# Rule1 standalone port plan

Status: **Complete**

Repository: [`wan0net/rule1`](https://github.com/wan0net/rule1) (**public**)
Reference source: `/Users/icd/Workspace/link42-rule1/rule1`

## Goal

Build a standalone, static Rule1 for eventual GitHub Pages hosting. The existing Rule1 is the product, interaction, and visual reference. Its code will be reviewed, corrected, documented where behaviour is non-obvious, and brought into this repository without either copying it blindly or redesigning the product.

The application will query a browser-local SQLite database generated from source files committed to Git. It must have no runtime dependency on Link42 services, Cloudflare, DigitalOcean, or another backend.

## Scope and constraints

- Preserve Rule1's recognisable desktop UI, information architecture, terminology, routes, and core behaviour.
- Bug fixes, maintainability refactors, useful types, and focused comments are in scope. Cosmetic redesign and unrelated feature work are not.
- Comments should explain non-obvious state, compatibility, ingestion, or query decisions—not restate code.
- Keep every framework source file and retained historical version in Git with its provenance.
- GitHub Actions builds one deterministic SQLite artifact.
- SQLite validation is intentionally limited to provenance, source checksums, schema, framework versions, row counts, and `PRAGMA integrity_check`.
- Do not add signing, attestations, evidence bundles, release policy engines, or other publication machinery.
- Desktop verification is required. Mobile-specific and accessibility work are out of scope.
- Known static-hosting gaps: authentication, cloud-synchronised favourites, community writes/voting, bypass tokens, and maintenance polling. Browser-local favourites remain in scope.
- Publication was approved and completed on 22 August 2026 at [`wan0.net/rule1`](https://wan0.net/rule1/).

## Ordered features

| # | Feature | Deliverable | Depends on | Tests / acceptance | Status |
|---|---|---|---|---|---|
| 1 | Review baseline | Inventory the old routes, components, shared packages, data contracts, and visible desktop behaviour. Record confirmed bugs, static-hosting conflicts, and intentional exclusions in a concise review ledger. | — | Each old route and user-facing capability has a disposition; proposed fixes distinguish defects from design changes; reference desktop screenshots are captured. | done |
| 2 | Standalone foundation | Create the independent TypeScript/SvelteKit workspace, static build configuration, test tooling, and `/rule1/` base-path support. Bring over only the shared Link42 code Rule1 needs. | 1 | Install, type-check, unit tests, and a static production build run with no monorepo dependency. Direct built routes and assets resolve beneath `/rule1/`. | done |
| 3 | Visual shell | Port and review the old layout, design tokens, typography, theme handling, header, navigation, footer, logos, errors, and landing page. Fix documented defects without changing the visual language. | 2 | Desktop screenshot comparison in light and dark themes has no unexplained product-level changes; theme persists locally; shell and landing tests pass. | done |
| 4 | Framework source archive | Bring the approved ISM, NZISM, Cyber Essentials, NIST CSF, and NIST SP 800-53 source files and retained history into Git. Add a small machine-readable provenance/checksum manifest. | 1 | Every ingested version maps to a committed source, origin, version/date, and SHA-256 checksum; missing or changed sources fail validation. | done |
| 5 | Reviewed ingestion and schema | Port the useful old parsers and schema, remove D1/backend coupling, fix confirmed ingestion defects, and generate a canonical SQLite database locally. | 4 | Parser/unit tests cover representative records for all five frameworks and retained versions; two clean local builds produce byte-identical SQLite files. | done |
| 6 | GitHub Actions SQLite build | Add one workflow that installs pinned tooling, runs ingestion, validates the database, and publishes the static-site database artifact. | 5 | CI checks only provenance, checksums, expected schema, framework/version coverage, recorded row counts, and `PRAGMA integrity_check`; repeated builds from the same commit have the same checksum. | done |
| 7 | Browser SQLite adapter | Implement a typed browser-side data client, worker-based SQLite loading, local caching where supported, and memory fallback. Match the response semantics the reviewed UI needs rather than preserving obsolete HTTP plumbing. | 5 | Contract tests cover framework metadata, groups, controls, search/filtering, details, history, mappings, graph data, comparison, and glossary queries; no runtime backend request is made. | done |
| 8 | Explorer core | Port and review framework selection, navigation hierarchy, search, filters, control lists, deep links, and control details against the local adapter. | 3, 7 | Desktop interaction tests cover all five frameworks, empty/error states, filters, deep links, refreshes, and representative control details; repaired bugs have regression tests. | done |
| 9 | Explorer relationships and history | Port and review control history, framework mappings, relationship/context views, and graph presentation supported by the retained data. | 8 | Tests cover version history, mapped/unmapped controls, graph/context loading, and missing-data states; desktop comparison has no unexplained interaction change. | done |
| 10 | Compare, glossary, and guide | Port and review the comparison workflow, glossary, guide, informational pages, and static-compatible redirects. Remove or correct claims tied to retired operated services. | 8 | Route and interaction tests cover comparison, glossary navigation/search, guide content, direct refresh, redirects, and not-found behaviour under `/rule1/`. | done |
| 11 | Local user features and exports | Port browser-local favourites, import/export, control exports, and local preference persistence. Omit cloud sync and write-oriented community/auth flows. | 8 | Tests cover favourites persistence, compatible import/export round trips, malformed imports, exports, and operation without authentication or network APIs. | done |
| 12 | Parity and release candidate | Run the complete desktop regression suite, compare the reviewed port with the old product, and document fixed bugs, intentional differences, known gaps, and remaining issues. | 6, 9, 10, 11 | Type-check, unit, ingestion, build, and desktop browser tests pass; all routes work at `/rule1/`; the built app makes no backend calls; differences are explained and approved. | done |
| 12a | Current Australian ISM | Archive and ingest the authoritative March and June 2026 Australian ISM OSCAL catalogs, refresh the validation contract, and close the December 2025 currency and principles gaps without changing the application or publication state. | 12 | Source checksums, parser and database tests, deterministic build validation, and regressions for 1,101 current controls, 49 principles, and Essential Eight mappings pass. | done |
| 13 | Publication | After a separate explicit approval, make the repository public, enable GitHub Pages, publish at `wan0.net/rule1`, and verify the deployed site and database. Do not change `rule1.link42.app` without separate approval. | 12a, publication approval | Live routes, assets, SQLite checksum, representative queries, and absence of backend calls are verified. | done |
| 14 | Initial database download splash | Show an honest first-load splash while the browser downloads and verifies SQLite, including byte progress when the server supplies a total and a short explanation that the initial catalogue is large and retained locally. Do not show the download splash when the checksum-keyed OPFS copy is reused. | 13 | Streamed download tests cover known and unknown content lengths, checksum verification, cache reuse, progress propagation, and splash states; browser verification uses a clean site-data context. | done |
| 15 | Control detail parity | Restore the reviewed old control-detail presentation around the standalone local data contract: compact header, breadcrumb, classification/change tags, familiar tabs, description treatment, and useful local control statistics. Do not restore backend, authentication, voting, or community features. | 13 | Focused component tests and desktop browser comparison against `rule1.link42.app` confirm no unexplained product-level difference in the control-detail view. | done |
| 16 | Legacy explorer deep links | Preserve published `?q=<control-id>` explorer links by opening an exact matching control while keeping non-ID `q` values as ordinary searches. Canonicalise restored links to the standalone `id`/`search` URL shape. | 15 | URL-state tests cover exact control IDs, free-text searches, precedence, and canonical output; live browser verification confirms `?q=ism-0009` opens ISM-0009. | done |
| 17 | Immediate database splash | Render the database-loading cover in the initial HTML for catalogue-backed routes and keep it visible continuously through startup, download, verification, and SQLite opening. Static informational routes must not be blocked. | 14 | Initial production HTML for catalogue routes contains the splash; lifecycle tests prevent a pre-progress gap and confirm the cover clears only when initialization finishes; browser verification uses a delayed database response. | done |
| 18 | ISM-only Essential Eight UI | Show Essential Eight mappings, maturity indicators, and statistics only for Australian ISM controls. Other frameworks must not render or request ISM-specific mapping information. | 15 | Explorer regression tests cover conditional mapping/stat rendering and query gating; browser verification confirms a non-ISM detail has no Essential Eight UI while an ISM detail retains it. | done |
| 19 | Changelog parity | Restore the previous control changelog presentation using retained local revisions: word-level statement changes, applicability additions/removals, guideline moves, withdrawals, source/compliance and complexity badges, and version-specific change styling. | 9, 15 | Pure change-model tests cover statement/applicability/move/withdrawal cases; component tests cover the previous visual semantics; browser comparison confirms representative ISM history exposes actual changes rather than repeated full statements. | done |
| 20 | AGPL release licensing | Licence Rule1's project-authored code and documentation under AGPL-3.0-or-later, explicitly preserve publisher terms for retained framework material, and document standalone use, verification, provenance, and the licensing boundary. | 13 | Package metadata, repository documentation, and the in-app guide agree on AGPL-3.0-or-later and exclude `data/` framework material from relicensing; the complete verification suite passes. | done |
| 21 | Compare parity and scrolling | Restore the previous sortable comparison table with classifications/applicability, complexity, framework-aware context, and safe word-level statement changes built from the shared changelog diff model; repair explorer-to-page scrolling so long comparison and informational routes remain scrollable without breaking the explorer's internal panes. | 19 | Pure comparison-presentation tests cover modified/new/withdrawn statements, applicability changes, classifications, context and sorting/filtering; route tests prevent global overflow leakage; desktop browser comparison confirms the table and scrolling match the previous UI. | done |

## Working rules

- Complete features in order, with one tested commit per feature and the feature number in the commit message.
- Update this plan when a discovered dependency changes the order or scope.
- Add dependencies only when the existing stack cannot reasonably meet the requirement.
- Preserve a regression test for each confirmed bug fixed during the port.
- Begin Feature 13 only after explicit publication approval, and do not mark it done until the public Pages deployment has been verified live.

## Definition of done

The port is ready to publish when it looks and behaves recognisably like the old Rule1 on desktop, documented defects are fixed, the code is standalone and understandable, all five approved frameworks and their retained history are served from deterministic browser-local SQLite, the static build has no operated runtime dependency, and the release candidate has received explicit publication approval.
