# Framework source archive

`data/source-ledger.json` records the 77 files used by the planned ingestion: 58 Australian ISM PDF releases, three Cyber Essentials JSON releases and two supporting PDFs, eight NZISM CSV releases, two NIST CSF OSCAL catalogs, and four NIST SP 800-53 OSCAL catalogs.

The NZISM CSVs are pinned to the already-approved `jlaundry/nzism` commit recorded in their origin URLs. The NIST SP 800-53 catalogs use immutable commits from the official `usnistgov/oscal-content` repository. Run `pnpm validate:sources` to reject missing, additional, or checksum-changed source files and mismatches with the NIST version manifests.

Known gaps kept outside this feature:

- Modern Australian ISM OSCAL and Excel history is not committed. The initial standalone ingestion will use the 58 retained PDF releases through December 2025.
- The old archive did not contain the Cyber Essentials 3.2 source PDF. Its committed 3.2 JSON ingestion source is retained and checksum-verified.
