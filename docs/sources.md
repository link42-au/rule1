# Framework source archive

`data/source-ledger.json` records the 83 files used by ingestion: 45 Australian ISM PDF releases, 18 official Australian ISM OSCAL catalogs, three Cyber Essentials JSON releases and two supporting PDFs, eight NZISM CSV releases, two NIST CSF OSCAL catalogs, four NIST SP 800-53 OSCAL catalogs, and one Enterprise ATT&CK STIX bundle. Together, the PDF and OSCAL sources retain 63 Australian ISM versions.

ASD's official OSCAL releases cover the June 2022 through September 2026 ISM editions. Rule1 retains the latest published OSCAL artifact for each edition, including ASD patch releases that supersede an earlier artifact for the same ISM edition. The committed catalogs come directly from ASD's versioned OSCAL artifact URLs; their catalog metadata versions and SHA-256 checksums are recorded in the ledger. This also restores the June 2023 and March 2025 editions that were missing from the previous PDF archive. ASD's authoritative `2026.09.4` OSCAL catalog is the sole retained September 2026 source.

The standalone parser carries forward the original Rule1 OSCAL handling for versioned ISM namespaces, applicability defaults, UUID cross-reference cleanup, stable hierarchical groups, nested controls, source ordering, glossary history, and revision-only metadata changes. The September 2026 OSCAL catalog is compared directly with June 2026 so its publisher changes—including modified, new and withdrawn controls—are represented in the retained history. For OSCAL editions, canonical Essential Eight mappings remain checked control-for-control against ASD's three official maturity-level profiles, so duplicate profile files are not required as ingestion inputs.

The NZISM CSVs are pinned to the already-approved `jlaundry/nzism` commit recorded in their origin URLs. The NIST SP 800-53 catalogs use immutable commits from the official `usnistgov/oscal-content` repository. Run `pnpm validate:sources` to reject missing, additional, or checksum-changed source files and mismatches with the NIST version manifests.

Enterprise ATT&CK 19.2 is pinned to MITRE CTI's signed immutable `ATT&CK-v19.2` tag. Rule1 ingests only active Enterprise techniques, sub-techniques, mitigations, and official `mitigates` relationships from the committed bundle. ATT&CK content is © The MITRE Corporation and used under Apache License 2.0; the project already retains that licence text at `LICENSES/Apache-2.0.txt`.

Rule1 keeps ATT&CK discovery separate from mapping authority. Curated control-to-mitigation bridges are expanded through official relationships only into `mappings/generated/attack-discovery-report.json`; those 6,592 discovery rows are neither candidates nor mappings and are not stored in the browser database. `mappings/ism-e8-attack-candidates.json` is the explicit direct control-to-technique review input. Each candidate carries the exact bridge and ATT&CK relationship, candidate-specific effect, confidence, rationale, and evidence from both the current ISM statement and ATT&CK. Only candidates with a separate named human review decision can be exposed by the reviewed-only browser query.

Known gaps kept outside this feature:

- ASD's official OSCAL repository does not cover ISM editions before June 2022. Standalone ingestion therefore retains 45 PDFs through March 2022, then uses official OSCAL catalogs from June 2022 onward.
- Australian ISM Excel history is not committed.
- The old archive did not contain the Cyber Essentials 3.2 source PDF. Its committed 3.2 JSON ingestion source is retained and checksum-verified.
