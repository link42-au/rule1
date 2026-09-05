# Framework source archive

`data/source-ledger.json` records the 83 files used by ingestion: 45 Australian ISM PDF releases, 18 official Australian ISM OSCAL catalogs, three Cyber Essentials JSON releases and two supporting PDFs, eight NZISM CSV releases, two NIST CSF OSCAL catalogs, four NIST SP 800-53 OSCAL catalogs, and one Enterprise ATT&CK STIX bundle. Together, the PDF and OSCAL sources retain 63 Australian ISM versions.

ASD's official OSCAL releases cover the June 2022 through September 2026 ISM editions. Rule1 retains the latest published OSCAL artifact for each edition, including ASD patch releases that supersede an earlier artifact for the same ISM edition. The committed catalogs come directly from ASD's versioned OSCAL artifact URLs; their catalog metadata versions and SHA-256 checksums are recorded in the ledger. This also restores the June 2023 and March 2025 editions that were missing from the previous PDF archive. ASD's authoritative `2026.09.4` OSCAL catalog is the sole retained September 2026 source.

The standalone parser carries forward the original Rule1 OSCAL handling for versioned ISM namespaces, applicability defaults, UUID cross-reference cleanup, stable hierarchical groups, nested controls, source ordering, glossary history, and revision-only metadata changes. The September 2026 OSCAL catalog is compared directly with June 2026 so its publisher changes—including modified, new and withdrawn controls—are represented in the retained history. For OSCAL editions, canonical Essential Eight mappings remain checked control-for-control against ASD's three official maturity-level profiles, so duplicate profile files are not required as ingestion inputs.

The NZISM CSVs are pinned to the already-approved `jlaundry/nzism` commit recorded in their origin URLs. The NIST SP 800-53 catalogs use immutable commits from the official `usnistgov/oscal-content` repository. Run `pnpm validate:sources` to reject missing, additional, or checksum-changed source files and mismatches with the NIST version manifests.

Enterprise ATT&CK 19.2 is pinned to MITRE CTI's signed immutable `ATT&CK-v19.2` tag. Rule1 ingests only active Enterprise techniques, sub-techniques, mitigations, and official `mitigates` relationships from the committed bundle. ATT&CK content is © The MITRE Corporation and used under Apache License 2.0; the project already retains that licence text at `LICENSES/Apache-2.0.txt`.

Rule1 authors only ISM-control-to-ATT&CK-mitigation relationships. Every active control in the September 2026 ISM is explicitly assessed against all 44 pinned mitigations using its exact statement, full section hierarchy and overview material, and retained factual interpretation. A mapped assessment records that the control `enables` a mitigation, classifies the relationship as `protect`, `detect`, or `recover`, and retains confidence, a control-specific rationale, exact source snapshots, and reproducible OpenRouter model, prompt, input-hash, and generation provenance. An unmapped assessment records a specific reason and no candidate. AI-generated relationships remain candidates until a separate named human review; Rule1 does not author a control-to-technique relationship.

Techniques are reached only through MITRE's official mitigation-to-technique relationships in the pinned bundle. This preserves MITRE's relationship description as the downstream claim instead of inventing a control-specific technique outcome.

The same pinned ATT&CK bundle supplies reported procedure examples from active intrusion sets, campaigns, malware, and tools. Rule1 retains every active `uses` relationship that targets an active Enterprise technique, including its STIX provenance and source references. These examples are contextual reports of technique use, not evidence that a mapped control covers an actor or software family. Browser queries run only after a reviewed ISM mapping reaches a technique and return at most five deterministically ordered examples per technique, together with the full stored count; all examples remain available in SQLite for later review.

Known gaps kept outside this feature:

- ASD's official OSCAL repository does not cover ISM editions before June 2022. Standalone ingestion therefore retains 45 PDFs through March 2022, then uses official OSCAL catalogs from June 2022 onward.
- Australian ISM Excel history is not committed.
- The old archive did not contain the Cyber Essentials 3.2 source PDF. Its committed 3.2 JSON ingestion source is retained and checksum-verified.
