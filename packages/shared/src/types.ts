// ── Framework types ──────────────────────────────────────────────────────────

export interface Framework {
  id: string;
  name: string;
  short_name: string;
  publisher: string | null;
  url: string | null;
  country: string | null;
}

// ── Control types ────────────────────────────────────────────────────────────

export interface Control {
  id: string;
  display_id: string;
  title?: string;
  label?: string;
  statement?: string;
  guideline?: string;
  section_id?: string;
  section?: string;
  change_type?: string;
  e8_levels?: string[];
  applicability?: string[];
  metadata?: Record<string, unknown>;
}

export interface Group {
  id: string;
  title: string;
  parent_id: string | null;
  control_count: number;
  children: Group[];
}

export interface Revision {
  statement?: string;
  applicability?: string[];
  e8_levels?: string[];
  e8_strategies?: { strategy: string; level: string }[];
  applicability_raw?: string[];
  catalog_version?: string;
  commit_date?: string;
  updated?: string;
  change_type?: string;
  guideline?: string;
  source?: string;
  compliance?: string;
  change_complexity?: string | null;
  metadata?: Record<string, unknown>;
}

export interface Annotation {
  ai_view: string | null;
  ai_view_snarky: string | null;
  links: { url: string; title: string }[];
  impls: { text: string; url?: string }[];
  updated_at: string;
}

export interface ControlDetail {
  framework: string;
  id: string;
  display_id: string;
  title?: string;
  label?: string;
  control_class?: string;
  section?: string;
  section_id?: string;
  section_overview?: string;
  latest: Revision;
  history: Revision[];
  annotation?: Annotation | null;
}

export interface GraphNode {
  data: {
    id: string;
    display_id?: string;
    statement?: string;
    label?: string;
    role?: string;
  };
}

export interface GraphData {
  nodes?: GraphNode[];
}

// ── Compare types ────────────────────────────────────────────────────────────

export interface VersionRow {
  version: string;
  date: string;
}

export interface ChangeRow {
  id: string;
  display_id: string;
  label: string;
  change_type: string;
  guideline: string | null;
  section: string | null;
  new_statement: string | null;
  old_statement: string | null;
  new_applicability: string[] | null;
  old_applicability: string[] | null;
  change_complexity?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CompareResponse {
  framework: string;
  from: string;
  to: string;
  changes: ChangeRow[];
  total: number;
}

// ── Glossary types ───────────────────────────────────────────────────────────

export interface GlossaryTerm {
  id: string;
  term: string;
  meaning: string;
}

// ── Stats ────────────────────────────────────────────────────────────────────

export interface Stats {
  framework: string;
  controls: number;
  principles: number;
  terms: number;
  version: string | null;
}
