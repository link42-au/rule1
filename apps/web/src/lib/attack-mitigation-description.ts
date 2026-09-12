export type AttackMitigationBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const bulletText = (line: string): string | null => {
  const match = line.trim().match(/^[-*][ \t]+(\S(?:.*\S)?)$/);
  return match?.[1] ?? null;
};

const nextContentLine = (lines: readonly string[], start: number): string | null => {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim()) return lines[index];
  }
  return null;
};

const isHeading = (lines: readonly string[], index: number): boolean => {
  const line = lines[index].trim();
  const next = nextContentLine(lines, index + 1);
  return line.length > 1 && line.length <= 120 && line.endsWith(":") && next !== null && bulletText(next) !== null;
};

export function parseAttackMitigationDescription(description: string): AttackMitigationBlock[] {
  if (!description.trim()) return [];

  const lines = description.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AttackMitigationBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      flushParagraph();
      continue;
    }
    if (isHeading(lines, index)) {
      flushParagraph();
      blocks.push({ type: "heading", text: line });
      continue;
    }
    const firstItem = bulletText(line);
    if (firstItem !== null) {
      flushParagraph();
      const items = [firstItem];
      while (index + 1 < lines.length) {
        const nextItem = bulletText(lines[index + 1]);
        if (nextItem === null) break;
        items.push(nextItem);
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
}
