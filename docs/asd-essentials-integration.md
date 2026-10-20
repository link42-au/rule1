# ASD Essentials for Enterprise IT — integration design

Status: implementation in progress. This document records the first reviewable increment; no ingestion or UI behaviour is changed by this commit.

## Scope

Add ASD Essentials for Enterprise IT as a **new** framework in Rule1. Do not replace Australian ISM, UK Cyber Essentials, or any existing historical sources.

## Source and provenance

- Obtain the authoritative ASD OSCAL catalog and accompanying extension definitions from ASD's published source.
- Archive the exact released bytes under a dedicated `data/essentials/` directory, subject to publisher terms.
- Record the publisher, version, release date, source URL, and SHA-256 in `data/source-ledger.json`.
- Reject missing files, checksum mismatches, invalid OSCAL structures, and unsupported extension formats. Never silently discard unfamiliar properties.

## Data model

Preserve OSCAL identifiers, titles, prose, grouping, links, properties, parts, and metadata. Specifically retain ASD's domains, priority phases, principles, actions, and indicators of good practice, including their original namespace and ordering. Prefer a lossless representation of extension properties alongside normalized fields needed for search and navigation. Keep cross-framework mappings explicitly attributed; do not infer equivalence to ISM controls.

## Application

- Register Essentials separately in framework/version selectors, Explorer, search, and Compare.
- Display ASD's hierarchy and extension fields without flattening distinct concepts into generic controls.
- Preserve existing ISM annotations, history, and existing UI behaviour.
- Label the framework clearly to avoid confusion with UK Cyber Essentials and Essential Eight.

## Acceptance

1. Authoritative source and extension schemas are retained with validated provenance.
2. Parser tests cover representative nested entries, namespaces, unknown properties, ordering, and missing values.
3. SQLite builds are deterministic and pass integrity, counts, and referential checks.
4. Explorer, search, Compare, and responsive browser tests exercise Essentials and existing frameworks.
5. `pnpm verify` passes before marking implementation complete.
6. Submit a draft PR from `wan0net:feature/asd-essentials-oscal` to `link42-au:main` for review; do not merge automatically.

## Open verification

Confirm the exact ASD release artifact URL, its licensing and extension schema before importing bytes. Do not fabricate an OSCAL catalog or checksum.
