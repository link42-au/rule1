PRAGMA page_size = 4096;
PRAGMA encoding = 'UTF-8';
PRAGMA auto_vacuum = NONE;
PRAGMA application_id = 1381321777;
PRAGMA user_version = 6;

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

CREATE TABLE annotations (
  framework TEXT NOT NULL,
  control_id TEXT NOT NULL,
  catalog_version TEXT NOT NULL,
  input_sha256 TEXT,
  prompt_version TEXT NOT NULL,
  model TEXT NOT NULL,
  ai_view TEXT NOT NULL,
  ai_view_snarky TEXT NOT NULL,
  links TEXT NOT NULL DEFAULT '[]',
  impls TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (framework, control_id)
);

CREATE TABLE attack_releases (
  version TEXT PRIMARY KEY,
  release_date TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain = 'enterprise-attack'),
  ordinal INTEGER NOT NULL UNIQUE
);

CREATE TABLE attack_source_files (
  path TEXT PRIMARY KEY,
  version TEXT NOT NULL REFERENCES attack_releases(version),
  source_date TEXT NOT NULL,
  origin TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64)
);

CREATE TABLE attack_techniques (
  attack_version TEXT NOT NULL REFERENCES attack_releases(version),
  technique_id TEXT NOT NULL,
  stix_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  tactics TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tactics)),
  platforms TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(platforms)),
  parent_technique_id TEXT,
  PRIMARY KEY (attack_version, technique_id),
  UNIQUE (attack_version, stix_id),
  FOREIGN KEY (attack_version, parent_technique_id)
    REFERENCES attack_techniques(attack_version, technique_id)
);

CREATE TABLE attack_mitigations (
  attack_version TEXT NOT NULL REFERENCES attack_releases(version),
  mitigation_id TEXT NOT NULL,
  stix_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  PRIMARY KEY (attack_version, mitigation_id),
  UNIQUE (attack_version, stix_id)
);

CREATE TABLE attack_mitigation_techniques (
  attack_version TEXT NOT NULL,
  mitigation_id TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  relationship_stix_id TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (attack_version, mitigation_id, technique_id),
  UNIQUE (attack_version, relationship_stix_id),
  UNIQUE (attack_version, mitigation_id, technique_id, relationship_stix_id),
  FOREIGN KEY (attack_version, mitigation_id)
    REFERENCES attack_mitigations(attack_version, mitigation_id),
  FOREIGN KEY (attack_version, technique_id)
    REFERENCES attack_techniques(attack_version, technique_id)
);

CREATE TABLE attack_procedure_entities (
  attack_version TEXT NOT NULL REFERENCES attack_releases(version),
  entity_stix_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('intrusion-set', 'campaign', 'malware', 'tool')),
  external_id TEXT CHECK (external_id IS NULL OR length(trim(external_id)) > 0),
  url TEXT CHECK (
    url IS NULL OR (length(trim(url)) > 0 AND (url LIKE 'https://%' OR url LIKE 'http://%'))
  ),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  external_references TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(external_references) AND json_type(external_references) = 'array'),
  PRIMARY KEY (attack_version, entity_stix_id),
  UNIQUE (attack_version, external_id)
);

CREATE TABLE attack_procedures (
  attack_version TEXT NOT NULL,
  relationship_stix_id TEXT NOT NULL,
  entity_stix_id TEXT NOT NULL,
  technique_id TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  external_references TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(external_references) AND json_type(external_references) = 'array'),
  PRIMARY KEY (attack_version, relationship_stix_id),
  UNIQUE (attack_version, entity_stix_id, technique_id),
  FOREIGN KEY (attack_version, entity_stix_id)
    REFERENCES attack_procedure_entities(attack_version, entity_stix_id),
  FOREIGN KEY (attack_version, technique_id)
    REFERENCES attack_techniques(attack_version, technique_id)
);

CREATE TABLE control_attack_assessments (
  framework TEXT NOT NULL DEFAULT 'ism' CHECK (framework = 'ism'),
  ism_catalog_version TEXT NOT NULL,
  control_id TEXT NOT NULL,
  attack_version TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('mapped', 'unmapped')),
  unmapped_reason TEXT,
  model TEXT NOT NULL CHECK (length(trim(model)) > 0),
  prompt_version TEXT NOT NULL CHECK (length(trim(prompt_version)) > 0),
  input_sha256 TEXT NOT NULL CHECK (length(input_sha256) = 64),
  generated_at TEXT NOT NULL CHECK (length(trim(generated_at)) > 0),
  PRIMARY KEY (framework, ism_catalog_version, control_id, attack_version),
  CHECK (
    (disposition = 'mapped' AND unmapped_reason IS NULL)
    OR (disposition = 'unmapped' AND length(trim(COALESCE(unmapped_reason, ''))) > 0)
  ),
  FOREIGN KEY (framework, control_id, ism_catalog_version)
    REFERENCES control_history(framework, control_id, catalog_version),
  FOREIGN KEY (attack_version) REFERENCES attack_releases(version)
);

CREATE TABLE control_attack_mitigation_mappings (
  candidate_id TEXT PRIMARY KEY,
  framework TEXT NOT NULL DEFAULT 'ism' CHECK (framework = 'ism'),
  ism_catalog_version TEXT NOT NULL,
  control_id TEXT NOT NULL,
  attack_version TEXT NOT NULL,
  mitigation_id TEXT NOT NULL,
  relationship TEXT NOT NULL CHECK (relationship = 'enables'),
  security_function TEXT NOT NULL CHECK (security_function IN ('protect', 'detect', 'recover')),
  confidence TEXT NOT NULL CHECK (confidence IN ('low', 'medium', 'high')),
  status TEXT NOT NULL CHECK (status IN ('candidate', 'reviewed', 'rejected')),
  rationale TEXT NOT NULL CHECK (length(trim(rationale)) > 0),
  evidence TEXT NOT NULL CHECK (json_valid(evidence) AND json_array_length(evidence) > 0),
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE (framework, ism_catalog_version, control_id, attack_version, mitigation_id),
  CHECK (
    (status = 'candidate' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status IN ('reviewed', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  FOREIGN KEY (framework, ism_catalog_version, control_id, attack_version)
    REFERENCES control_attack_assessments(
      framework, ism_catalog_version, control_id, attack_version
    ),
  FOREIGN KEY (attack_version, mitigation_id)
    REFERENCES attack_mitigations(attack_version, mitigation_id)
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
CREATE INDEX idx_attack_technique_parent ON attack_techniques(attack_version, parent_technique_id);
CREATE INDEX idx_attack_relationship_technique
  ON attack_mitigation_techniques(attack_version, technique_id, mitigation_id);
CREATE INDEX idx_attack_procedure_entity_name
  ON attack_procedure_entities(attack_version, entity_type, name, entity_stix_id);
CREATE INDEX idx_attack_procedure_technique
  ON attack_procedures(attack_version, technique_id, entity_stix_id, relationship_stix_id);
CREATE INDEX idx_attack_procedure_entity
  ON attack_procedures(attack_version, entity_stix_id, technique_id, relationship_stix_id);
CREATE INDEX idx_attack_assessment_disposition
  ON control_attack_assessments(
    framework, ism_catalog_version, disposition, control_id
  );
CREATE INDEX idx_attack_mapping_mitigation
  ON control_attack_mitigation_mappings(attack_version, mitigation_id, status, candidate_id);
CREATE INDEX idx_attack_mapping_status
  ON control_attack_mitigation_mappings(
    framework, ism_catalog_version, control_id, status, candidate_id
  );
