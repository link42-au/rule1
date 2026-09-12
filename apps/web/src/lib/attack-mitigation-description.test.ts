import { describe, expect, it } from "vitest";
import { parseAttackMitigationDescription } from "$lib/attack-mitigation-description";

describe("ATT&CK guidance blocks", () => {
  it("parses M1053-style prose, headings and bullet runs without reordering wording", () => {
    const description = `Data Backup involves taking and securely storing backups of data from end-user systems and critical servers. It ensures that data remains available in the event of system compromise, ransomware attacks, or other disruptions. This mitigation can be implemented through the following measures:

Regular Backup Scheduling:
- Use Case: Ensure timely and consistent backups of critical data.
- Implementation: Schedule daily incremental backups and weekly full backups for all critical servers and systems.

Immutable Backups:
- Use Case: Protect backups from modification or deletion, even by attackers.
- Implementation: Use write-once-read-many (WORM) storage for backups, preventing ransomware from encrypting or deleting backup files.`;

    expect(parseAttackMitigationDescription(description)).toEqual([
      {
        type: "paragraph",
        text: "Data Backup involves taking and securely storing backups of data from end-user systems and critical servers. It ensures that data remains available in the event of system compromise, ransomware attacks, or other disruptions. This mitigation can be implemented through the following measures:",
      },
      { type: "heading", text: "Regular Backup Scheduling:" },
      {
        type: "list",
        items: [
          "Use Case: Ensure timely and consistent backups of critical data.",
          "Implementation: Schedule daily incremental backups and weekly full backups for all critical servers and systems.",
        ],
      },
      { type: "heading", text: "Immutable Backups:" },
      {
        type: "list",
        items: [
          "Use Case: Protect backups from modification or deletion, even by attackers.",
          "Implementation: Use write-once-read-many (WORM) storage for backups, preventing ransomware from encrypting or deleting backup files.",
        ],
      },
    ]);
  });

  it("retains ordinary paragraphs and their source order", () => {
    expect(parseAttackMitigationDescription("First paragraph.\n\nSecond paragraph.\nStill second paragraph.")).toEqual([
      { type: "paragraph", text: "First paragraph." },
      { type: "paragraph", text: "Second paragraph.\nStill second paragraph." },
    ]);
  });

  it("falls back to plain paragraphs for malformed headings and bullets", () => {
    expect(parseAttackMitigationDescription("Recovery:\nThis is prose, not a list.\n-not a bullet\n- ")).toEqual([
      { type: "paragraph", text: "Recovery:\nThis is prose, not a list.\n-not a bullet\n-" },
    ]);
    expect(parseAttackMitigationDescription("  \n\n  ")).toEqual([]);
  });

  it("keeps HTML-like input as literal data", () => {
    expect(
      parseAttackMitigationDescription(
        "<script>alert('xss')</script>\n\nUnsafe example:\n- <img src=x onerror=alert(1)>",
      ),
    ).toEqual([
      { type: "paragraph", text: "<script>alert('xss')</script>" },
      { type: "heading", text: "Unsafe example:" },
      { type: "list", items: ["<img src=x onerror=alert(1)>"] },
    ]);
  });
});
