# Framework source archive

`data/source-ledger.json` records the 79 files used by ingestion: 58 historical Australian ISM PDF releases, two current official Australian ISM OSCAL catalogs, three Cyber Essentials JSON releases and two supporting PDFs, eight NZISM CSV releases, two NIST CSF OSCAL catalogs, and four NIST SP 800-53 OSCAL catalogs.

The March and June 2026 Australian ISM catalogs come directly from ASD's versioned OSCAL artifact URLs. Their catalog metadata versions (`2026.03.24` and `2026.06.18`) and committed checksums are retained in the source and ledger.

The NZISM CSVs are pinned to the already-approved `jlaundry/nzism` commit recorded in their origin URLs. The NIST SP 800-53 catalogs use immutable commits from the official `usnistgov/oscal-content` repository. Run `pnpm validate:sources` to reject missing, additional, or checksum-changed source files and mismatches with the NIST version manifests.

Known gaps kept outside this feature:

- Australian ISM Excel history is not committed. Standalone ingestion uses 58 retained historical PDFs followed by the official March and June 2026 OSCAL catalogs.
- The old archive did not contain the Cyber Essentials 3.2 source PDF. Its committed 3.2 JSON ingestion source is retained and checksum-verified.
