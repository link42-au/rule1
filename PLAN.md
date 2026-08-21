# Rule1 standalone port plan

Status: **Approved for implementation**

Repository: `wan0net/rule1` (**private**)
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
- Keep the repository private and GitHub Pages disabled until explicit publication approval.

## Ordered features

| # | Feature | Deliverable | Depends on | Tests / acceptance | Status |
|---|---|---|---|---|---|
| 1 | Review baseline | Inventory the old routes, components, shared packages, data contracts, and visible desktop behaviour. Record confirmed bugs, static-hosting conflicts, and intentional exclusions in a concise review ledger. | — | Each old route and user-facing capability has a disposition; proposed fixes distinguish defects from design changes; reference desktop screenshots are captured. | done |
| 2 | Standalone foundation | Create the independent TypeScript/SvelteKit workspace, static build configuration, test tooling, and `/rule1/` base-path support. Bring over only the shared Link42 code Rule1 needs. | 1 | Install, type-check, unit tests, and a static production build run with no monorepo dependency. Direct built routes and assets resolve beneath `/rule1/`. | done |
| 3 | Visual shell | Port and review the old layout, design tokens, typography, theme handling, header, navigation, footer, logos, errors, and landing page. Fix documented defects without changing the visual language. | 2 | Desktop screenshot comparison in light and dark themes has no unexplained product-level changes; theme persists locally; shell and landing tests pass. | done |
| 4 | Framework source archive | Bring the approved ISM, NZISM, Cyber Essentials, NIST CSF, and NIST SP 800-53 source files and retained history into Git. Add a small machine-readable provenance/checksum manifest. | 1 | Every ingested version maps to a committed source, origin, version/date, and SHA-256 checksum; missing or changed sources fail validation. | pending |
| 5 | Reviewed ingestion and schema | Port the useful old parsers and schema, remove D1/backend coupling, fix confirmed ingestion defects, and generate a canonical SQLite database locally. | 4 | Parser/unit tests cover representative records for all five frameworks and retained versions; two clean local builds produce byte-identical SQLite files. | pending |
| 6 | GitHub Actions SQLite build | Add one workflow that installs pinned tooling, runs ingestion, validates the database, and publishes the static-site database artifact. | 5 | CI checks only provenance, checksums, expected schema, framework/version coverage, recorded row counts, and `PRAGMA integrity_check`; repeated builds from the same commit have the same checksum. | pending |
| 7 | Browser SQLite adapter | Implement a typed browser-side data client, worker-based SQLite loading, local caching where supported, and memory fallback. Match the response semantics the reviewed UI needs rather than preserving obsolete HTTP plumbing. | 5 | Contract tests cover framework metadata, groups, controls, search/filtering, details, history, mappings, graph data, comparison, and glossary queries; no runtime backend request is made. | pending |
| 8 | Explorer core | Port and review framework selection, navigation hierarchy, search, filters, control lists, deep links, and control details against the local adapter. | 3, 7 | Desktop interaction tests cover all five frameworks, empty/error states, filters, deep links, refreshes, and representative control details; repaired bugs have regression tests. | pending |
| 9 | Explorer relationships and history | Port and review control history, framework mappings, relationship/context views, and graph presentation supported by the retained data. | 8 | Tests cover version history, mapped/unmapped controls, graph/context loading, and missing-data states; desktop comparison has no unexplained interaction change. | pending |
| 10 | Compare, glossary, and guide | Port and review the comparison workflow, glossary, guide, informational pages, and static-compatible redirects. Remove or correct claims tied to retired operated services. | 8 | Route and interaction tests cover comparison, glossary navigation/search, guide content, direct refresh, redirects, and not-found behaviour under `/rule1/`. | pending |
| 11 | Local user features and exports | Port browser-local favourites, import/export, control exports, and local preference persistence. Omit cloud sync and write-oriented community/auth flows. | 8 | Tests cover favourites persistence, compatible import/export round trips, malformed imports, exports, and operation without authentication or network APIs. | pending |
| 12 | Parity and release candidate | Run the complete desktop regression suite, compare the reviewed port with the old product, and document fixed bugs, intentional differences, known gaps, and remaining issues. | 6, 9, 10, 11 | Type-check, unit, ingestion, build, and desktop browser tests pass; all routes work at `/rule1/`; the built app makes no backend calls; differences are explained and approved. | pending |
| 13 | Publication | After a separate explicit approval, make the repository public, enable GitHub Pages, publish at `wan0.net/rule1`, and verify the deployed site and database. Do not change `rule1.link42.app` without separate approval. | 12, publication approval | Live routes, assets, SQLite checksum, representative queries, and absence of backend calls are verified. | blocked |

## Working rules

- Complete features in order, with one tested commit per feature and the feature number in the commit message.
- Update this plan when a discovered dependency changes the order or scope.
- Add dependencies only when the existing stack cannot reasonably meet the requirement.
- Preserve a regression test for each confirmed bug fixed during the port.
- Stop before Feature 13 and present the release candidate for approval.

## Definition of done

The port is ready to publish when it looks and behaves recognisably like the old Rule1 on desktop, documented defects are fixed, the code is standalone and understandable, all five approved frameworks and their retained history are served from deterministic browser-local SQLite, the static build has no operated runtime dependency, and the release candidate has received explicit publication approval.
