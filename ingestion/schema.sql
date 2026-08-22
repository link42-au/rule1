PRAGMA page_size = 4096;
PRAGMA encoding = 'UTF-8';
PRAGMA auto_vacuum = NONE;
PRAGMA application_id = 1381321777;
PRAGMA user_version = 1;

CREATE TABLE frameworks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  country TEXT,
  accent_color TEXT
);

CREATE TABLE catalog_versions (
  framework TEXT NOT NULL REFERENCES frameworks(id),
  version TEXT NOT NULL,
  commit_date TEXT NOT NULL,
  commit_hash TEXT,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (framework, version)
);

CREATE TABLE source_files (
  path TEXT PRIMARY KEY,
  framework TEXT NOT NULL,
  version TEXT NOT NULL,
  source_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  FOREIGN KEY (framework, version) REFERENCES catalog_versions(framework, version)
);

CREATE TABLE control_groups (
  framework TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT,
  overview TEXT,
  parent_id TEXT,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (framework, catalog_version, id),
  FOREIGN KEY (framework, catalog_version) REFERENCES catalog_versions(framework, version)
);

CREATE TABLE control_history (
  framework TEXT NOT NULL,
  control_id TEXT NOT NULL,
  display_id TEXT,
  label TEXT,
  title TEXT,
  catalog_version TEXT NOT NULL,
  commit_date TEXT NOT NULL,
  statement TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('new', 'modified', 'unchanged', 'withdrawn')),
  section_id TEXT,
  section_title TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  applicability TEXT,
  applicability_raw TEXT,
  e8_levels TEXT,
  updated TEXT,
  guideline TEXT,
  control_class TEXT NOT NULL,
  source TEXT NOT NULL,
  compliance TEXT,
  revision TEXT,
  change_complexity TEXT,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (framework, control_id, catalog_version),
  FOREIGN KEY (framework, catalog_version) REFERENCES catalog_versions(framework, version)
);

CREATE TABLE term_history (
  term_id TEXT NOT NULL,
  framework TEXT NOT NULL,
  term TEXT,
  catalog_version TEXT NOT NULL,
  commit_date TEXT NOT NULL,
  meaning TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN ('new', 'modified', 'unchanged', 'withdrawn')),
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (framework, term_id, catalog_version),
  FOREIGN KEY (framework, catalog_version) REFERENCES catalog_versions(framework, version)
);

CREATE TABLE e8_mappings (
  framework TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  control_id TEXT NOT NULL,
  level TEXT NOT NULL,
  strategy TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (framework, catalog_version, control_id, level, strategy),
  FOREIGN KEY (framework, control_id, catalog_version)
    REFERENCES control_history(framework, control_id, catalog_version)
);

CREATE TABLE build_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE build_counts (
  table_name TEXT NOT NULL,
  framework TEXT NOT NULL DEFAULT '',
  catalog_version TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL CHECK (row_count >= 0),
  PRIMARY KEY (table_name, framework, catalog_version)
);

CREATE INDEX idx_versions_framework ON catalog_versions(framework, ordinal);
CREATE INDEX idx_groups_version ON control_groups(framework, catalog_version, ordinal);
CREATE INDEX idx_controls_version ON control_history(framework, catalog_version, ordinal);
CREATE INDEX idx_controls_identity ON control_history(framework, control_id, catalog_version);
CREATE INDEX idx_controls_section ON control_history(framework, catalog_version, section_id, ordinal);
CREATE INDEX idx_terms_version ON term_history(framework, catalog_version, term COLLATE NOCASE);
CREATE INDEX idx_e8_control ON e8_mappings(framework, catalog_version, control_id);
