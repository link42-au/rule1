# Contributing to Rule1

Rule1 welcomes focused bug fixes, accessibility improvements, ingestion corrections, tests, and documentation updates that preserve the standalone GitHub Pages architecture and the reviewed interface.

## Bugs, suggestions, and security reports

Use the repository's structured forms so reports reach the right place:

- [Report a bug](https://github.com/link42-au/rule1/issues/new?template=bug_report.yml) with the affected route or control, expected and actual behaviour, reproducible steps, browser details, and any non-sensitive supporting material.
- [Suggest an improvement](https://github.com/link42-au/rule1/issues/new?template=feature_request.yml) with the problem or opportunity, the proposed outcome, who benefits, and any alternatives considered.
- Check [existing issues](https://github.com/link42-au/rule1/issues) first, and add useful reproduction details to an existing report instead of opening a duplicate.

Security vulnerabilities must be reported privately through [GitHub Security Advisories](https://github.com/link42-au/rule1/security/advisories/new), following [SECURITY.md](SECURITY.md). Never include exploit details, credentials, personal information, or other sensitive material in a public issue.

The canonical deployment is [rule1.link42.app](https://rule1.link42.app/), and the source is hosted by the [`link42-au`](https://github.com/link42-au) organisation in [`link42-au/rule1`](https://github.com/link42-au/rule1).

## Before opening a pull request

1. Discuss large behavioural, schema, dependency, or framework-source changes in an issue first.
2. Install the pinned Node.js, pnpm, Python, and uv versions documented in the [README](README.md).
3. Keep changes independent of operated APIs, accounts, or external databases. Do not commit credentials, environment files, generated SQLite databases, or unrelated workspace material.
4. For framework-source changes, commit the authoritative source file and update its provenance, version, source URL, and SHA-256 entry in `data/source-ledger.json`. Publisher material remains under its publisher's terms and is not relicensed by Rule1.
5. Add a regression test for changed behaviour and run `pnpm verify` before requesting review.

Keep pull requests small enough to review, explain user-visible differences, and call out anything that was not verified locally. New dependencies need a concrete justification and compatible licensing.

By submitting project-authored code or documentation, you agree that your contribution may be distributed under `AGPL-3.0-or-later`.
