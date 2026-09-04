import { describe, expect, it } from "vitest";
import { compareSnapshots, type ComparisonRecord } from "./compare";
import { canonicalFrameworkId } from "./contracts";
import { filterControls } from "./filters";
import { dispatchRule1Query, type QueryExecutor, type SqlValue } from "./queries";

type Row = Record<string, unknown>;
type Fixture = Row[] | ((bind: readonly SqlValue[]) => Row[]);

class FixtureExecutor implements QueryExecutor {
  readonly calls: { name: string; sql: string; bind: readonly SqlValue[] }[] = [];

  constructor(private readonly fixtures: Record<string, Fixture>) {}

  async all<T extends Row>(sql: string, bind: readonly SqlValue[] = []): Promise<T[]> {
    const name = /\/\* rule1:([\w-]+) \*\//.exec(sql)?.[1];
    if (!name) throw new Error("Query has no fixture marker");
    this.calls.push({ name, sql, bind });
    const fixture = this.fixtures[name];
    if (!fixture) return [];
    return (typeof fixture === "function" ? fixture(bind) : fixture) as T[];
  }
}

describe("Rule1 domain helpers", () => {
  it("accepts the CE URL alias but rejects unknown frameworks", () => {
    expect(canonicalFrameworkId("ce")).toBe("cyber-essentials");
    expect(canonicalFrameworkId("nist-csf")).toBe("nist-csf");
    expect(() => canonicalFrameworkId("other")).toThrow(RangeError);
  });

  it("filters lifecycle, E8, applicability, text, and exact numeric IDs", () => {
    const controls = [
      {
        id: "ism-9",
        display_id: "ISM-9",
        statement: "Patch systems",
        change_type: "modified",
        e8_levels: ["ML1"],
        applicability: ["P"],
      },
      { id: "ism-10", display_id: "ISM-10", statement: "Retired", change_type: "withdrawn", e8_levels: [] },
      {
        id: "ism-11",
        display_id: "ISM-11",
        statement: "Backups",
        change_type: "new",
        e8_levels: ["ML3"],
        applicability: ["S"],
      },
    ];
    expect(filterControls(controls, "ism").map((row) => row.id)).toEqual(["ism-9", "ism-11"]);
    expect(filterControls(controls, "ism", { filter: "withdrawn" }).map((row) => row.id)).toEqual(["ism-10"]);
    expect(filterControls(controls, "ism", { filter: "ml1", applicability: "P" }).map((row) => row.id)).toEqual([
      "ism-9",
    ]);
    expect(filterControls(controls, "ism", { search: "9" }).map((row) => row.id)).toEqual(["ism-9"]);
    expect(filterControls(controls, "ism", { search: "backup" }).map((row) => row.id)).toEqual(["ism-11"]);
  });

  it("compares arbitrary snapshots without repeating withdrawal tombstones", () => {
    const oldRows: ComparisonRecord[] = [
      { control_id: "ism-1", display_id: "ISM-1", statement: "old", change_type: "modified" },
      { control_id: "ism-2", display_id: "ISM-2", statement: "gone", change_type: "withdrawn" },
      { control_id: "ism-3", display_id: "ISM-3", statement: "active", change_type: "unchanged" },
    ];
    const newRows: ComparisonRecord[] = [
      { control_id: "ism-1", display_id: "ISM-1", statement: "new", change_type: "unchanged" },
      { control_id: "ism-2", display_id: "ISM-2", statement: "gone", change_type: "withdrawn" },
      { control_id: "ism-3", display_id: "ISM-3", statement: "active", change_type: "withdrawn" },
      { control_id: "ism-4", display_id: "ISM-4", statement: "added", change_type: "new" },
    ];
    const result = compareSnapshots("ism", "v1", "v3", oldRows, newRows);
    expect(result.changes.map((row) => [row.id, row.change_type])).toEqual([
      ["ism-1", "modified"],
      ["ism-3", "withdrawn"],
      ["ism-4", "new"],
    ]);
    expect(result.changes.find((row) => row.id === "ism-3")).toMatchObject({
      old_e8_levels: [],
      new_e8_levels: null,
    });
    expect(result.changes.find((row) => row.id === "ism-4")).toMatchObject({
      old_e8_levels: null,
      new_e8_levels: [],
    });
  });

  it("compares visible control content rather than revision and sort bookkeeping", () => {
    const before: ComparisonRecord = {
      control_id: "ism-1",
      display_id: "ISM-1",
      statement: "Same statement",
      change_type: "unchanged",
      revision: "1",
      updated: "Mar-26",
      metadata: { authority: "ASD", sort_id: "catalog[1].control[1]" },
    };
    const bookkeepingOnly: ComparisonRecord = {
      ...before,
      revision: "2",
      updated: "Jun-26",
      metadata: { authority: "ASD", sort_id: "catalog[1].control[2]" },
    };
    expect(compareSnapshots("ism", "v1", "v2", [before], [bookkeepingOnly]).changes).toEqual([]);
  });

  it("retains Essential Eight-only, mixed, and removed mapping changes", () => {
    const before: ComparisonRecord[] = [
      {
        control_id: "ism-1",
        display_id: "ISM-1",
        statement: "Same statement",
        change_type: "unchanged",
        e8_levels: ["ML1"],
      },
      {
        control_id: "ism-2",
        display_id: "ISM-2",
        statement: "Before",
        change_type: "unchanged",
        e8_levels: ["ML2"],
      },
      {
        control_id: "ism-3",
        display_id: "ISM-3",
        statement: "No mapping",
        change_type: "unchanged",
        e8_levels: [],
      },
      {
        control_id: "ism-4",
        display_id: "ISM-4",
        statement: "Same mapping order does not matter",
        change_type: "unchanged",
        e8_levels: ["ML1", "ML3"],
      },
    ];
    const after: ComparisonRecord[] = [
      { ...before[0], e8_levels: ["ML3"] },
      { ...before[1], statement: "After", e8_levels: [] },
      { ...before[2], e8_levels: [] },
      { ...before[3], e8_levels: ["ML3", "ML1"] },
    ];

    expect(compareSnapshots("ism", "v1", "v2", before, after).changes).toMatchObject([
      {
        id: "ism-1",
        change_type: "modified",
        old_statement: "Same statement",
        new_statement: "Same statement",
        old_e8_levels: ["ML1"],
        new_e8_levels: ["ML3"],
      },
      {
        id: "ism-2",
        change_type: "modified",
        old_statement: "Before",
        new_statement: "After",
        old_e8_levels: ["ML2"],
        new_e8_levels: [],
      },
    ]);
  });
});

describe("Rule1 query dispatcher", () => {
  it("decodes framework, stats, versions, controls, and typed empty terms", async () => {
    const executor = new FixtureExecutor({
      frameworks: [
        {
          id: "cyber-essentials",
          name: "Cyber Essentials",
          short_name: "CE",
          publisher: "NCSC",
          url: "https://example.test",
          country: "GB",
        },
      ],
      stats: [{ version: "CE-3.3", controls: 33, principles: 0, terms: 0 }],
      versions: [
        { version: "CE-3.2", date: "2025-01-01" },
        { version: "CE-3.3", date: "2026-01-01" },
      ],
      controls: [
        {
          control_id: "ce-d1",
          display_id: "D1",
          statement: "Do it",
          applicability: "[]",
          e8_levels: "[]",
          metadata: '{"area":"devices"}',
          change_type: "new",
        },
      ],
      terms: [],
    });
    await expect(dispatchRule1Query(executor, "frameworks", undefined)).resolves.toHaveLength(1);
    await expect(dispatchRule1Query(executor, "stats", { framework: "ce" })).resolves.toMatchObject({
      framework: "cyber-essentials",
      controls: 33,
    });
    await expect(dispatchRule1Query(executor, "versions", { framework: "ce" })).resolves.toHaveLength(2);
    await expect(dispatchRule1Query(executor, "controls", { framework: "ce" })).resolves.toMatchObject({
      framework: "cyber-essentials",
      total: 1,
      controls: [{ id: "ce-d1", metadata: { area: "devices" } }],
    });
    await expect(dispatchRule1Query(executor, "terms", { framework: "ce" })).resolves.toEqual({ terms: [], total: 0 });
    expect(executor.calls.find((call) => call.name === "versions")?.sql).toContain("ORDER BY ordinal");
  });

  it("builds version-scoped groups, detail, history, E8 data, and graph", async () => {
    const executor = new FixtureExecutor({
      groups: [
        { id: "root", title: "Root", parent_id: null },
        { id: "child", title: "Child", parent_id: "root" },
      ],
      "group-counts": [{ section_id: "child", control_count: 2 }],
      control: [
        {
          control_id: "ism-1",
          display_id: "ISM-1",
          catalog_version: "v2",
          statement: "Current",
          section_id: "child",
          section_title: "Child",
          section_overview: "Overview",
          applicability: '["P"]',
          e8_levels: '["ML1"]',
          metadata: "{}",
        },
      ],
      "control-history-summary": [
        {
          catalog_version: "v2",
          commit_date: "2026-01-01",
          change_type: "modified",
          applicability: '["P"]',
          e8_levels: '["ML1"]',
          metadata: "{}",
        },
      ],
      "control-history": [
        {
          catalog_version: "v2",
          commit_date: "2026-01-01",
          statement: "Current",
          change_type: "modified",
          applicability: '["P"]',
          e8_levels: '["ML1"]',
          metadata: "{}",
        },
      ],
      "e8-mappings": [{ level: "ML1", strategy: "Patch applications" }],
      annotation: [
        {
          ai_view: "A factual description.",
          ai_view_snarky: "A Professional description.",
          links: '[{"url":"https://example.com","title":"Reference"}]',
          impls: '[{"text":"Implement it","url":"https://example.com/how"}]',
          updated_at: "2026-09-03T00:00:00Z",
        },
      ],
      "graph-center": [
        {
          control_id: "ism-1",
          display_id: "ISM-1",
          statement: "Current",
          section_id: "child",
          section_title: "Child",
          catalog_version: "v2",
        },
      ],
      "graph-peers": [
        { control_id: "ism-1", display_id: "ISM-1", statement: "Current" },
        { control_id: "ism-2", display_id: "ISM-2", statement: "Peer" },
      ],
    });
    await expect(dispatchRule1Query(executor, "groups", { framework: "ism" })).resolves.toMatchObject([
      { id: "root", control_count: 2, children: [{ id: "child", control_count: 2 }] },
    ]);
    await expect(dispatchRule1Query(executor, "control", { framework: "ism", id: "ISM-1" })).resolves.toMatchObject({
      id: "ism-1",
      section_overview: "Overview",
      annotation: {
        ai_view: "A factual description.",
        ai_view_snarky: "A Professional description.",
        links: [{ url: "https://example.com", title: "Reference" }],
        impls: [{ text: "Implement it", url: "https://example.com/how" }],
        updated_at: "2026-09-03T00:00:00Z",
      },
      latest: { e8_strategies: [{ level: "ML1", strategy: "Patch applications" }] },
    });
    await expect(
      dispatchRule1Query(executor, "controlHistory", { framework: "ism", id: "ism-1" }),
    ).resolves.toMatchObject([{ statement: "Current" }]);
    await expect(dispatchRule1Query(executor, "graph", { framework: "ism", id: "ism-1" })).resolves.toMatchObject({
      group: { id: "child" },
      nodes: [{ data: { role: "center" } }, { data: { id: "ism-2", role: "neighbor" } }],
      edges: [{ data: { source: "ism-1", target: "ism-2" } }],
    });
    const detailSql = executor.calls.find((call) => call.name === "control")?.sql ?? "";
    expect(detailSql).toContain("g.catalog_version = h.catalog_version");
    expect(executor.calls.find((call) => call.name === "e8-mappings")?.bind).toEqual(["ism", "v2", "ism-1"]);
    expect(executor.calls.find((call) => call.name === "annotation")?.bind).toEqual(["ism", "ism-1"]);
  });

  it("does not query Essential Eight mappings for non-ISM control details", async () => {
    const executor = new FixtureExecutor({
      control: [
        {
          control_id: "nzism-1",
          display_id: "NZISM-1",
          catalog_version: "v2",
          statement: "Current",
          applicability: "[]",
          e8_levels: "[]",
          metadata: "{}",
        },
      ],
      "control-history-summary": [],
      "e8-mappings": [{ level: "ML1", strategy: "Must not be requested" }],
    });

    await expect(dispatchRule1Query(executor, "control", { framework: "nzism", id: "NZISM-1" })).resolves.toMatchObject(
      {
        framework: "nzism",
        annotation: null,
        latest: { e8_strategies: [] },
      },
    );
    expect(executor.calls.some((call) => call.name === "e8-mappings")).toBe(false);
  });

  it("exposes only reviewed ATT&CK mappings and gates non-ISM requests before SQL", async () => {
    const executor = new FixtureExecutor({
      "attack-mapping-versions": [
        {
          ism_catalog_version: "ISM-OSCAL-2026.09.4",
          attack_version: "19.2",
        },
      ],
      "attack-mappings": [
        {
          ism_catalog_version: "ISM-OSCAL-2026.09.4",
          attack_version: "19.2",
          technique_id: "T1110",
          technique_name: "Brute Force",
          technique_description: "Attempt credentials.",
          technique_url: "https://attack.mitre.org/techniques/T1110/",
          tactics: '["credential-access"]',
          platforms: '["Windows"]',
          parent_technique_id: null,
          mitigation_id: "M1032",
          mitigation_name: "Multi-factor Authentication",
          mitigation_description: "Use MFA.",
          mitigation_url: "https://attack.mitre.org/mitigations/M1032/",
          effect: "prevent",
          confidence: "high",
          rationale: "MFA may prevent successful use of guessed credentials.",
          bridge_evidence: '[{"kind":"bridge"}]',
          decision_evidence: '[{"kind":"review"}]',
        },
      ],
    });

    await expect(
      dispatchRule1Query(executor, "attackMappings", { framework: "ism", id: "ISM-1173" }),
    ).resolves.toMatchObject({
      ismCatalogVersion: "ISM-OSCAL-2026.09.4",
      attackVersion: "19.2",
      mappings: [
        {
          techniqueId: "T1110",
          mitigationId: "M1032",
          tactics: ["credential-access"],
          evidence: [{ kind: "bridge" }, { kind: "review" }],
        },
      ],
    });
    const attackCall = executor.calls.find((call) => call.name === "attack-mappings");
    expect(attackCall?.bind).toEqual(["ism-1173"]);
    expect(attackCall?.sql).toContain("m.status = 'reviewed'");
    expect(attackCall?.sql).toContain("ORDER BY m.technique_id, m.mitigation_id, b.effect");
    expect(attackCall?.sql).not.toContain("m.effect");
    expect(attackCall?.sql).not.toContain("candidate");

    const callsBeforeGate = executor.calls.length;
    await expect(
      dispatchRule1Query(executor, "attackMappings", { framework: "nzism", id: "nzism-1" }),
    ).resolves.toEqual({ ismCatalogVersion: null, attackVersion: null, mappings: [] });
    expect(executor.calls).toHaveLength(callsBeforeGate);
  });

  it("validates compare versions and returns term history", async () => {
    const executor = new FixtureExecutor({
      versions: [
        { version: "v1", date: "2025-01-01" },
        { version: "v2", date: "2026-01-01" },
      ],
      "compare-snapshot": (bind) =>
        bind[1] === "v1"
          ? [{ control_id: "nzism-1", display_id: "NZISM-1", statement: "Before", change_type: "unchanged" }]
          : [{ control_id: "nzism-1", display_id: "NZISM-1", statement: "After", change_type: "unchanged" }],
      term: [
        {
          id: "patching",
          term: "Patching",
          meaning: "Applying updates",
          catalog_version: "v2",
          commit_date: "2026-01-01",
          change_type: "modified",
        },
      ],
    });
    await expect(
      dispatchRule1Query(executor, "compare", { framework: "nzism", from: "v1", to: "v2" }),
    ).resolves.toMatchObject({ total: 1, changes: [{ change_type: "modified" }] });
    expect(executor.calls.find((call) => call.name === "compare-snapshot")?.sql).toContain("e8_levels");
    await expect(
      dispatchRule1Query(executor, "compare", { framework: "nzism", from: "bad", to: "v2" }),
    ).rejects.toThrow(RangeError);
    await expect(dispatchRule1Query(executor, "term", { framework: "nzism", id: "PATCHING" })).resolves.toMatchObject({
      id: "patching",
      history: [{ catalog_version: "v2" }],
    });
  });

  it("covers reference lists and missing-data results without inventing records", async () => {
    const executor = new FixtureExecutor({
      guidelines: [{ guideline: "Access control", control_count: 3 }],
      principles: [
        {
          control_id: "ism-p1",
          display_id: "P1",
          statement: "A principle",
          applicability: "[]",
          e8_levels: "[]",
          metadata: "{}",
        },
      ],
      sections: [
        {
          id: "access",
          title: "Access",
          overview: "Overview",
          guideline: "Access control",
          control_count: 3,
        },
      ],
    });
    await expect(dispatchRule1Query(executor, "guidelines", { framework: "ism" })).resolves.toEqual([
      { guideline: "Access control", control_count: 3 },
    ]);
    await expect(dispatchRule1Query(executor, "guidelines", { framework: "nzism" })).resolves.toEqual([]);
    await expect(dispatchRule1Query(executor, "principles", { framework: "ism" })).resolves.toMatchObject({
      total: 1,
      principles: [{ id: "ism-p1" }],
    });
    await expect(dispatchRule1Query(executor, "sections", { framework: "ism" })).resolves.toEqual([
      {
        id: "access",
        title: "Access",
        overview: "Overview",
        guideline: "Access control",
        control_count: 3,
      },
    ]);
    await expect(dispatchRule1Query(executor, "control", { framework: "ism", id: "missing" })).resolves.toBeNull();
    await expect(dispatchRule1Query(executor, "term", { framework: "ism", id: "missing" })).resolves.toBeNull();
    await expect(dispatchRule1Query(executor, "graph", { framework: "ism", id: "missing" })).resolves.toEqual({
      nodes: [],
      edges: [],
      group: null,
    });
    await expect(
      dispatchRule1Query(executor, "e8Mappings", {
        framework: "ism",
        id: "ism-1",
        catalogVersion: "v2",
      }),
    ).resolves.toEqual([]);
    expect(executor.calls.find((call) => call.name === "sections")?.sql).toContain(
      "g.catalog_version = h.catalog_version",
    );
    expect(executor.calls.find((call) => call.name === "e8-mappings")?.sql).toContain("TRIM(strategy) != ''");
  });
});
