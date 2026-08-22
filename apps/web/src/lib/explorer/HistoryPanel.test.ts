import { readFile } from "node:fs/promises";
import type { Revision } from "@rule1/shared";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import HistoryPanel from "./HistoryPanel.svelte";

const panelSource = await readFile(new URL("./HistoryPanel.svelte", import.meta.url), "utf8");

describe("control history panel", () => {
  const history: Revision[] = [
    {
      catalog_version: "v3",
      statement: "Require <strong> passwords.",
      applicability: ["P", "S"],
      guideline: "Authentication",
      change_type: "modified",
      source: "pdf",
      compliance: "Must",
    },
    {
      catalog_version: "v2",
      statement: "Require passwords.",
      applicability: ["P"],
      guideline: "Identity",
      change_type: "modified",
      change_complexity: "high",
    },
    { catalog_version: "v1", statement: "Use passwords.", guideline: "Access", change_type: "new" },
  ];

  it("server-renders previous UI change semantics from structured retained data", () => {
    const { body } = render(HistoryPanel, { props: { history, status: "ready", frameworkLabel: "NZISM" } });

    expect(body).toContain("Current");
    expect(body).toContain("Modified");
    expect(body).toContain("New");
    expect(body).toContain("Statement changes");
    expect(body).toContain("Applicability changes");
    expect(body).toContain("Before");
    expect(body).toContain("After");
    expect(body).toContain("Moved");
    expect(body).toContain("PDF");
    expect(body).toContain("Compliance:");
    expect(body).toContain("High");
    expect(body).toContain("&lt;strong>");
    expect(body).not.toContain("<strong> passwords");
  });

  it("uses the selected framework name in withdrawal wording", () => {
    const { body } = render(HistoryPanel, {
      props: {
        history: [{ catalog_version: "2026", change_type: "withdrawn" }],
        status: "ready",
        frameworkLabel: "Cyber Essentials",
      },
    });
    expect(body).toContain("removed from the Cyber Essentials catalogue");
    expect(body).not.toContain("removed from the ISM catalog");
  });

  it("does not inject generated or retained HTML", () => {
    expect(panelSource).not.toContain("{@html");
    expect(panelSource).toContain("<del>{part.text}</del>");
    expect(panelSource).toContain("<ins>{part.text}</ins>");
    expect(panelSource).toContain("data-kind={entry.dotKind}");
    for (const kind of ["current", "modified", "new", "withdrawn", "moved"]) {
      expect(panelSource).toContain(`.timeline-dot[data-kind="${kind}"]`);
    }
  });
});
