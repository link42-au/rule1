# Framework source archive

`data/source-ledger.json` records the 81 files used by ingestion: 45 historical Australian ISM PDF releases, 17 official Australian ISM OSCAL catalogs, three Cyber Essentials JSON releases and two supporting PDFs, eight NZISM CSV releases, two NIST CSF OSCAL catalogs, and four NIST SP 800-53 OSCAL catalogs.

ASD's official OSCAL releases cover the June 2022 through June 2026 ISM editions. Rule1 retains the latest published OSCAL artifact for each edition, including ASD patch releases that supersede an earlier artifact for the same ISM edition. The committed catalogs come directly from ASD's versioned OSCAL artifact URLs; their catalog metadata versions and SHA-256 checksums are recorded in the ledger. This also restores the June 2023 and March 2025 editions that were missing from the previous PDF archive.

The NZISM CSVs are pinned to the already-approved `jlaundry/nzism` commit recorded in their origin URLs. The NIST SP 800-53 catalogs use immutable commits from the official `usnistgov/oscal-content` repository. Run `pnpm validate:sources` to reject missing, additional, or checksum-changed source files and mismatches with the NIST version manifests.

Known gaps kept outside this feature:

- ASD's official OSCAL repository does not cover ISM editions before June 2022. Standalone ingestion therefore retains the 45 available PDFs through March 2022, then uses official OSCAL catalogs.
- Australian ISM Excel history is not committed.
- The old archive did not contain the Cyber Essentials 3.2 source PDF. Its committed 3.2 JSON ingestion source is retained and checksum-verified.
