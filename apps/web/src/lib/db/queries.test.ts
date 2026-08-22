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
      annotation: null,
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
        latest: { e8_strategies: [] },
      },
    );
    expect(executor.calls.some((call) => call.name === "e8-mappings")).toBe(false);
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
