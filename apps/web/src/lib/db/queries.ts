import type {
  Control,
  ControlDetail,
  Framework,
  GlossaryTerm,
  GraphData,
  Group,
  Guideline,
  Revision,
  Section,
  Stats,
  TermDetail,
  VersionRow,
} from "@rule1/shared";
import { compareSnapshots, type ComparisonRecord } from "./compare";
import {
  canonicalFrameworkId,
  type CompareParams,
  type ControlParams,
  type ControlsResult,
  type E8Mapping,
  type E8MappingParams,
  type FrameworkParams,
  type PrinciplesResult,
  type TermsResult,
} from "./contracts";
import { jsonArray, jsonObject, nullableText, numberValue, text } from "./decode";
export type SqlValue = string | number | null | Uint8Array;
export type Rule1QueryMethod =
  | "frameworks"
  | "stats"
  | "versions"
  | "guidelines"
  | "principles"
  | "sections"
  | "groups"
  | "controls"
  | "control"
  | "controlHistory"
  | "e8Mappings"
  | "graph"
  | "compare"
  | "terms"
  | "term";

export interface QueryExecutor {
  all<T extends Record<string, unknown>>(sql: string, bind?: readonly SqlValue[]): Promise<T[]>;
}

type Row = Record<string, unknown>;

const LATEST_VERSION = `(
  SELECT version FROM catalog_versions
  WHERE framework = ? ORDER BY ordinal DESC LIMIT 1
)`;

const objectParams = (params: unknown): Record<string, unknown> => {
  if (!params || typeof params !== "object" || Array.isArray(params))
    throw new TypeError("Query params must be an object");
  return params as Record<string, unknown>;
};

const requiredString = (params: Record<string, unknown>, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${key} must be a non-empty string`);
  return value;
};

const frameworkParams = (params: unknown): FrameworkParams => {
  const input = objectParams(params);
  return { framework: canonicalFrameworkId(requiredString(input, "framework")) };
};

const controlParams = (params: unknown): ControlParams => {
  const input = objectParams(params);
  return {
    framework: canonicalFrameworkId(requiredString(input, "framework")),
    id: requiredString(input, "id").toLowerCase(),
  };
};

const e8Params = (params: unknown): E8MappingParams => {
  const input = objectParams(params);
  return {
    framework: canonicalFrameworkId(requiredString(input, "framework")),
    id: requiredString(input, "id").toLowerCase(),
    catalogVersion: requiredString(input, "catalogVersion"),
  };
};

const compareParams = (params: unknown): CompareParams => {
  const input = objectParams(params);
  return {
    framework: canonicalFrameworkId(requiredString(input, "framework")),
    from: requiredString(input, "from"),
    to: requiredString(input, "to"),
  };
};

const decodeControl = (row: Row): Control => ({
  id: text(row.control_id),
  display_id: text(row.display_id, text(row.control_id)),
  title: nullableText(row.title) ?? undefined,
  label: nullableText(row.label) ?? undefined,
  statement: nullableText(row.statement) ?? undefined,
  guideline: nullableText(row.guideline) ?? undefined,
  section_id: nullableText(row.section_id) ?? undefined,
  section: nullableText(row.section_title) ?? undefined,
  change_type: nullableText(row.change_type) ?? undefined,
  e8_levels: jsonArray(row.e8_levels),
  applicability: jsonArray(row.applicability),
  metadata: jsonObject(row.metadata),
});

const decodeRevision = (row: Row, includeStatement: boolean): Revision => ({
  ...(includeStatement ? { statement: nullableText(row.statement) ?? undefined } : {}),
  applicability: jsonArray(row.applicability),
  applicability_raw: jsonArray(row.applicability_raw),
  e8_levels: jsonArray(row.e8_levels),
  catalog_version: nullableText(row.catalog_version) ?? undefined,
  commit_date: nullableText(row.commit_date) ?? undefined,
  updated: nullableText(row.updated) ?? undefined,
  change_type: nullableText(row.change_type) ?? undefined,
  guideline: nullableText(row.guideline) ?? undefined,
  source: nullableText(row.source) ?? undefined,
  compliance: nullableText(row.compliance) ?? undefined,
  revision: nullableText(row.revision) ?? undefined,
  change_complexity: nullableText(row.change_complexity),
  metadata: jsonObject(row.metadata),
});

async function frameworks(executor: QueryExecutor): Promise<Framework[]> {
  const rows = await executor.all<Row>(`/* rule1:frameworks */
    SELECT id, name, short_name, publisher, url, country FROM frameworks ORDER BY id`);
  return rows.map((row) => ({
    id: text(row.id),
    name: text(row.name),
    short_name: text(row.short_name),
    publisher: nullableText(row.publisher),
    url: nullableText(row.url),
    country: nullableText(row.country),
  }));
}

async function stats(executor: QueryExecutor, params: FrameworkParams): Promise<Stats> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:stats */
    SELECT cv.version,
      SUM(CASE WHEN h.change_type != 'withdrawn'
        AND (? != 'ism' OR h.control_class = 'ISM-control') THEN 1 ELSE 0 END) AS controls,
      SUM(CASE WHEN ? = 'ism' AND h.control_class = 'ISM-principle' THEN 1 ELSE 0 END) AS principles,
      (SELECT COUNT(*) FROM term_history t
        WHERE t.framework = ? AND t.catalog_version = cv.version) AS terms
    FROM catalog_versions cv
    LEFT JOIN control_history h ON h.framework = cv.framework AND h.catalog_version = cv.version
    WHERE cv.framework = ? AND cv.ordinal = (
      SELECT MAX(ordinal) FROM catalog_versions WHERE framework = ?
    ) GROUP BY cv.version`,
    [framework, framework, framework, framework, framework],
  );
  const row = rows[0];
  return {
    framework,
    controls: numberValue(row?.controls),
    principles: numberValue(row?.principles),
    terms: numberValue(row?.terms),
    version: nullableText(row?.version),
  };
}

async function versions(executor: QueryExecutor, params: FrameworkParams): Promise<VersionRow[]> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:versions */
    SELECT version, commit_date AS date FROM catalog_versions
    WHERE framework = ? ORDER BY ordinal`,
    [framework],
  );
  return rows.map((row) => ({ version: text(row.version), date: text(row.date) }));
}

async function guidelines(executor: QueryExecutor, params: FrameworkParams): Promise<Guideline[]> {
  const framework = canonicalFrameworkId(params.framework);
  if (framework !== "ism") return [];
  const rows = await executor.all<Row>(
    `/* rule1:guidelines */
    SELECT guideline, COUNT(*) AS control_count FROM control_history
    WHERE framework = ? AND catalog_version = ${LATEST_VERSION}
      AND control_class = 'ISM-control' AND change_type != 'withdrawn'
      AND guideline IS NOT NULL
    GROUP BY guideline ORDER BY guideline`,
    [framework, framework],
  );
  return rows.map((row) => ({ guideline: text(row.guideline), control_count: numberValue(row.control_count) }));
}

async function principles(executor: QueryExecutor, params: FrameworkParams): Promise<PrinciplesResult> {
  const framework = canonicalFrameworkId(params.framework);
  if (framework !== "ism") return { principles: [], total: 0 };
  const rows = await executor.all<Row>(
    `/* rule1:principles */
    SELECT * FROM control_history WHERE framework = ? AND catalog_version = ${LATEST_VERSION}
      AND control_class = 'ISM-principle' ORDER BY ordinal`,
    [framework, framework],
  );
  const result = rows.map(decodeControl);
  return { principles: result, total: result.length };
}

async function sections(executor: QueryExecutor, params: FrameworkParams): Promise<Section[]> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:sections */
    SELECT h.section_id AS id, COALESCE(g.title, h.section_title, h.section_id) AS title,
      g.overview, MIN(h.guideline) AS guideline, COUNT(*) AS control_count
    FROM control_history h
    LEFT JOIN control_groups g ON g.framework = h.framework
      AND g.catalog_version = h.catalog_version AND g.id = h.section_id
    WHERE h.framework = ? AND h.catalog_version = ${LATEST_VERSION}
      AND h.section_id IS NOT NULL AND h.change_type != 'withdrawn'
      AND (? != 'ism' OR h.control_class = 'ISM-control')
    GROUP BY h.section_id, g.title, g.overview, h.section_title
    ORDER BY title`,
    [framework, framework, framework],
  );
  return rows.map((row) => ({
    id: text(row.id),
    title: text(row.title),
    overview: nullableText(row.overview),
    guideline: nullableText(row.guideline),
    control_count: numberValue(row.control_count),
  }));
}

function groupTree(groupRows: readonly Row[], countRows: readonly Row[]): Group[] {
  const directCounts = new Map(countRows.map((row) => [text(row.section_id), numberValue(row.control_count)]));
  const nodes = new Map<string, Group>();
  for (const row of groupRows) {
    const id = text(row.id);
    nodes.set(id, {
      id,
      title: text(row.title, id),
      parent_id: nullableText(row.parent_id),
      control_count: directCounts.get(id) ?? 0,
      children: [],
    });
  }
  const roots: Group[] = [];
  for (const node of nodes.values()) {
    const parent = node.parent_id ? nodes.get(node.parent_id) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sumAndSort = (node: Group, path: Set<string>): number => {
    if (path.has(node.id)) return node.control_count;
    const next = new Set(path).add(node.id);
    node.children = node.children.filter((child) => !next.has(child.id));
    node.children.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    node.control_count += node.children.reduce((total, child) => total + sumAndSort(child, next), 0);
    return node.control_count;
  };
  roots.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  for (const root of roots) sumAndSort(root, new Set());
  return roots;
}

async function groups(executor: QueryExecutor, params: FrameworkParams): Promise<Group[]> {
  const framework = canonicalFrameworkId(params.framework);
  const [groupRows, countRows] = await Promise.all([
    executor.all<Row>(
      `/* rule1:groups */
      SELECT id, title, parent_id FROM control_groups
      WHERE framework = ? AND catalog_version = ${LATEST_VERSION} ORDER BY ordinal`,
      [framework, framework],
    ),
    executor.all<Row>(
      `/* rule1:group-counts */
      SELECT section_id, COUNT(*) AS control_count FROM control_history
      WHERE framework = ? AND catalog_version = ${LATEST_VERSION}
        AND change_type != 'withdrawn' AND (? != 'ism' OR control_class = 'ISM-control')
      GROUP BY section_id`,
      [framework, framework, framework],
    ),
  ]);
  return groupTree(groupRows, countRows);
}

async function controls(executor: QueryExecutor, params: FrameworkParams): Promise<ControlsResult> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:controls */
    SELECT control_id, COALESCE(display_id, control_id) AS display_id, label, title,
      statement, applicability, e8_levels, change_type, updated, catalog_version,
      guideline, section_id, section_title, metadata
    FROM control_history WHERE framework = ? AND catalog_version = ${LATEST_VERSION}
      AND (? != 'ism' OR control_class = 'ISM-control') ORDER BY ordinal`,
    [framework, framework, framework],
  );
  const result = rows.map(decodeControl);
  return { framework, controls: result, total: result.length };
}

const HISTORY_COLUMNS = `h.catalog_version, h.commit_date, h.statement, h.change_type,
  h.applicability, h.applicability_raw, h.e8_levels, h.revision, h.updated, h.guideline,
  h.source, h.compliance, h.change_complexity, h.metadata`;

async function e8Mappings(executor: QueryExecutor, params: E8MappingParams): Promise<E8Mapping[]> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:e8-mappings */
    SELECT level, strategy FROM e8_mappings
    WHERE framework = ? AND catalog_version = ? AND control_id = ?
      AND TRIM(strategy) != '' ORDER BY level, strategy`,
    [framework, params.catalogVersion, params.id.toLowerCase()],
  );
  return rows.map((row) => ({ level: text(row.level), strategy: text(row.strategy) }));
}

async function control(executor: QueryExecutor, params: ControlParams): Promise<ControlDetail | null> {
  const framework = canonicalFrameworkId(params.framework);
  const id = params.id.toLowerCase();
  const latestRows = await executor.all<Row>(
    `/* rule1:control */
    SELECT h.*, g.overview AS section_overview
    FROM control_history h
    JOIN catalog_versions v ON v.framework = h.framework AND v.version = h.catalog_version
    LEFT JOIN control_groups g ON g.framework = h.framework
      AND g.catalog_version = h.catalog_version AND g.id = h.section_id
    WHERE h.framework = ? AND h.control_id = ? ORDER BY v.ordinal DESC LIMIT 1`,
    [framework, id],
  );
  const latestRow = latestRows[0];
  if (!latestRow) return null;

  const [historyRows, mappings] = await Promise.all([
    executor.all<Row>(
      `/* rule1:control-history-summary */
      SELECT ${HISTORY_COLUMNS} FROM control_history h
      JOIN catalog_versions v ON v.framework = h.framework AND v.version = h.catalog_version
      WHERE h.framework = ? AND h.control_id = ? ORDER BY v.ordinal DESC`,
      [framework, id],
    ),
    framework === "ism"
      ? e8Mappings(executor, { framework, id, catalogVersion: text(latestRow.catalog_version) })
      : Promise.resolve([]),
  ]);
  const latest = decodeRevision(latestRow, true);
  latest.e8_strategies = mappings;
  return {
    framework,
    id,
    display_id: text(latestRow.display_id, id),
    title: nullableText(latestRow.title) ?? undefined,
    label: nullableText(latestRow.label) ?? undefined,
    control_class: nullableText(latestRow.control_class) ?? undefined,
    section: nullableText(latestRow.section_title) ?? undefined,
    section_id: nullableText(latestRow.section_id) ?? undefined,
    section_overview: text(latestRow.section_overview),
    latest,
    history: historyRows.map((row) => decodeRevision(row, false)),
    annotation: null,
  };
}

async function controlHistory(executor: QueryExecutor, params: ControlParams): Promise<Revision[]> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:control-history */
    SELECT ${HISTORY_COLUMNS} FROM control_history h
    JOIN catalog_versions v ON v.framework = h.framework AND v.version = h.catalog_version
    WHERE h.framework = ? AND h.control_id = ? ORDER BY v.ordinal DESC`,
    [framework, params.id.toLowerCase()],
  );
  return rows.map((row) => decodeRevision(row, true));
}

async function graph(executor: QueryExecutor, params: ControlParams): Promise<GraphData> {
  const framework = canonicalFrameworkId(params.framework);
  const id = params.id.toLowerCase();
  const centerRows = await executor.all<Row>(
    `/* rule1:graph-center */
    SELECT h.control_id, COALESCE(h.display_id, h.control_id) AS display_id,
      h.label, h.statement, h.section_id, h.section_title, h.catalog_version
    FROM control_history h
    JOIN catalog_versions v ON v.framework = h.framework AND v.version = h.catalog_version
    WHERE h.framework = ? AND h.control_id = ? ORDER BY v.ordinal DESC LIMIT 1`,
    [framework, id],
  );
  const center = centerRows[0];
  if (!center?.section_id) return { nodes: [], edges: [], group: null };

  const peers = await executor.all<Row>(
    `/* rule1:graph-peers */
    SELECT control_id, COALESCE(display_id, control_id) AS display_id,
      label, statement, change_type FROM control_history
    WHERE framework = ? AND catalog_version = ? AND section_id = ?
      AND change_type != 'withdrawn' AND (? != 'ism' OR control_class = 'ISM-control')
    ORDER BY ordinal`,
    [framework, text(center.catalog_version), text(center.section_id), framework],
  );
  const peerRows = peers.filter((row) => row.control_id !== id);
  return {
    nodes: [
      {
        data: {
          id,
          display_id: text(center.display_id, id),
          label: nullableText(center.label) ?? undefined,
          statement: nullableText(center.statement) ?? undefined,
          role: "center",
        },
      },
      ...peerRows.map((row) => ({
        data: {
          id: text(row.control_id),
          display_id: text(row.display_id, text(row.control_id)),
          label: nullableText(row.label) ?? undefined,
          statement: nullableText(row.statement) ?? undefined,
          role: "neighbor",
        },
      })),
    ],
    edges: peerRows.map((row) => {
      const target = text(row.control_id);
      return { data: { id: `${id}--${target}`, source: id, target, group: nullableText(center.section_title) } };
    }),
    group: { id: text(center.section_id), title: nullableText(center.section_title) },
  };
}

async function compare(executor: QueryExecutor, params: CompareParams) {
  const framework = canonicalFrameworkId(params.framework);
  const known = new Set((await versions(executor, { framework })).map((row) => row.version));
  if (!known.has(params.from) || !known.has(params.to))
    throw new RangeError("Comparison version does not belong to framework");
  if (params.from === params.to) return compareSnapshots(framework, params.from, params.to, [], []);
  const sql = `/* rule1:compare-snapshot */
    SELECT control_id, display_id, label, title, statement, change_type, applicability,
      guideline, section_id, section_title, metadata, compliance, revision, change_complexity
    FROM control_history WHERE framework = ? AND catalog_version = ?
      AND (? != 'ism' OR control_class = 'ISM-control') ORDER BY ordinal`;
  const [before, after] = await Promise.all([
    executor.all<ComparisonRecord>(sql, [framework, params.from, framework]),
    executor.all<ComparisonRecord>(sql, [framework, params.to, framework]),
  ]);
  return compareSnapshots(framework, params.from, params.to, before, after);
}

async function terms(executor: QueryExecutor, params: FrameworkParams): Promise<TermsResult> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:terms */
    SELECT term_id AS id, term, meaning FROM term_history
    WHERE framework = ? AND catalog_version = ${LATEST_VERSION}
    ORDER BY term COLLATE NOCASE`,
    [framework, framework],
  );
  const result: GlossaryTerm[] = rows.map((row) => ({
    id: text(row.id),
    term: text(row.term),
    meaning: text(row.meaning),
  }));
  return { terms: result, total: result.length };
}

async function term(executor: QueryExecutor, params: ControlParams): Promise<TermDetail | null> {
  const framework = canonicalFrameworkId(params.framework);
  const rows = await executor.all<Row>(
    `/* rule1:term */
    SELECT t.term_id AS id, t.term, t.catalog_version, t.commit_date, t.meaning, t.change_type
    FROM term_history t
    JOIN catalog_versions v ON v.framework = t.framework AND v.version = t.catalog_version
    WHERE t.framework = ? AND t.term_id = ? ORDER BY v.ordinal DESC`,
    [framework, params.id.toLowerCase()],
  );
  if (!rows.length) return null;
  return {
    id: text(rows[0]?.id),
    term: text(rows[0]?.term),
    history: rows.map((row) => ({
      id: text(row.id),
      term: text(row.term),
      meaning: text(row.meaning),
      catalog_version: text(row.catalog_version),
      commit_date: text(row.commit_date),
      change_type: text(row.change_type),
    })),
  };
}

export async function dispatchRule1Query(
  executor: QueryExecutor,
  method: Rule1QueryMethod,
  params: unknown,
): Promise<unknown> {
  switch (method) {
    case "frameworks":
      return frameworks(executor);
    case "stats":
      return stats(executor, frameworkParams(params));
    case "versions":
      return versions(executor, frameworkParams(params));
    case "guidelines":
      return guidelines(executor, frameworkParams(params));
    case "principles":
      return principles(executor, frameworkParams(params));
    case "sections":
      return sections(executor, frameworkParams(params));
    case "groups":
      return groups(executor, frameworkParams(params));
    case "controls":
      return controls(executor, frameworkParams(params));
    case "control":
      return control(executor, controlParams(params));
    case "controlHistory":
      return controlHistory(executor, controlParams(params));
    case "e8Mappings":
      return e8Mappings(executor, e8Params(params));
    case "graph":
      return graph(executor, controlParams(params));
    case "compare":
      return compare(executor, compareParams(params));
    case "terms":
      return terms(executor, frameworkParams(params));
    case "term":
      return term(executor, controlParams(params));
  }
}
