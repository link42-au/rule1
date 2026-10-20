# ASD Essentials for Enterprise IT

ASD Essentials for Enterprise IT is a separate framework in Rule1. It does not replace Australian ISM, Essential Eight, UK Cyber Essentials, or any historical source. Its actions and assessment indicators are presented using ASD's terminology; no ISM equivalence is inferred.

## Publisher evidence

The retained 2026.10.15 catalogue at `data/essentials/E4EIT_catalog-2026.10.15.json` is byte-identical to the [authoritative ASD release artifact](https://www.cyber.gov.au/e4eit/oscal/v2026.10.15/artifacts/E4EIT_catalog.json), checked on 20 October 2026. Its SHA-256 is `29b602fbbce89d83f9dffd6e6f99d32d1929b563a967f62b2c1cb52891fdb7d2`; the source ledger also retains the ASD GitHub release mirror URL originally used for acquisition.

`ingestion/sources/essentials/` retains the eight exact publisher domain profiles, the [Essentials namespace definitions](https://www.cyber.gov.au/ns/essentials/oscal/1.0), and the release-tagged publisher README with the copyright, disclaimer and CC BY 4.0 notice. Its manifest records each URL and byte checksum. These are supporting evidence, not additional framework versions. Their complete file set and checksums are verified before ingestion; they are excluded from formatting to preserve publisher bytes. The publisher defines extensions on the namespace page, rather than providing a separate extension JSON schema.

The source archive remains independent of network availability. Tests and builds never fetch changing upstream material.

## Retained semantics

The catalogue contains 28 principles, 58 actions and 33 hierarchical groups. All action properties, links and nested parts remain intact in `metadata.oscal`; ancestor group metadata, catalogue metadata, and domain profile documents remain available in `metadata.essentials`. Unknown extensions are retained and available in the source metadata disclosure. Malformed arrays, nested parts, properties, links, duplicate IDs, missing profiles, checksum mismatches and unresolved publisher references fail closed.

Domain descriptions and priority phases come from the domain profiles for the same release. Phases belong to domains; Rule1 does not infer an action's maturity level or turn them into Essential Eight mappings. Domain order, phase order, principle hierarchy and indicator order follow the source. ATT&CK references are labelled as publisher-supplied references and kept separate from reviewed ISM mappings.

## Browser behaviour

Explorer provides the ASD Essentials framework selector, domain filtering, action navigation, principle prose, actions, applicable domains, priority phases and the ordered effectiveness indicator groups. Search includes identifiers, action prose, principles, domains and indicator statements. Nested prose is rendered as text, without executing publisher HTML. All retained metadata is inspectable.

Compare identifies that only one version is retained and requires a second genuine release before comparison. It does not manufacture a historical baseline. Other framework histories and annotations remain unchanged.

## Verification and publication

`pnpm verify` covers source/archive checks, parser regression tests, database validation, web unit tests, static build and browser tests. Essentials browser tests exercise search, domain filters, Compare, desktop/phone reflow and automated accessibility. CI additionally requires a second byte-identical database build and a container smoke test. No checks are disabled for this framework.

The production target is `link42-au/rule1` and `https://rule1.link42.app/`. Merge and deployment are explicitly authorised by the user for this implementation; the earlier draft-only boundary is superseded. Production publication uses the existing verified `main` workflow, including complete annotation checks and a live deployment canary. Passing PR checks alone is not deployment evidence.
