import type {
  CompareResponse,
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

export const FRAMEWORK_IDS = ["cyber-essentials", "ism", "nist-800-53", "nist-csf", "nzism"] as const;

export type FrameworkId = (typeof FRAMEWORK_IDS)[number];
export type FrameworkInput = FrameworkId | "ce";

export interface FrameworkParams {
  framework: FrameworkInput;
}

export interface ControlParams extends FrameworkParams {
  id: string;
}

export interface E8MappingParams extends ControlParams {
  catalogVersion: string;
}

export interface CompareParams extends FrameworkParams {
  from: string;
  to: string;
}

export interface ControlsResult {
  framework: FrameworkId;
  controls: Control[];
  total: number;
}

export interface PrinciplesResult {
  principles: Control[];
  total: number;
}

export interface TermsResult {
  terms: GlossaryTerm[];
  total: number;
}

export interface E8Mapping {
  level: string;
  strategy: string;
}

export interface AttackMapping {
  attackVersion: string;
  ismCatalogVersion: string;
  techniqueId: string;
  techniqueName: string;
  techniqueDescription: string | null;
  techniqueUrl: string;
  tactics: string[];
  platforms: string[];
  parentTechniqueId: string | null;
  mitigationId: string;
  mitigationName: string;
  mitigationDescription: string | null;
  mitigationUrl: string;
  effect: "prevent" | "constrain" | "detect" | "recover";
  confidence: "low" | "medium" | "high";
  rationale: string;
  evidence: Record<string, unknown>[];
}

export interface AttackMappingResult {
  ismCatalogVersion: string | null;
  attackVersion: string | null;
  mappings: AttackMapping[];
}

export interface Rule1DataClient {
  frameworks(): Promise<Framework[]>;
  stats(params: FrameworkParams): Promise<Stats>;
  versions(params: FrameworkParams): Promise<VersionRow[]>;
  guidelines(params: FrameworkParams): Promise<Guideline[]>;
  principles(params: FrameworkParams): Promise<PrinciplesResult>;
  sections(params: FrameworkParams): Promise<Section[]>;
  groups(params: FrameworkParams): Promise<Group[]>;
  controls(params: FrameworkParams): Promise<ControlsResult>;
  control(params: ControlParams): Promise<ControlDetail | null>;
  controlHistory(params: ControlParams): Promise<Revision[]>;
  e8Mappings(params: E8MappingParams): Promise<E8Mapping[]>;
  attackMappings(params: ControlParams): Promise<AttackMappingResult>;
  graph(params: ControlParams): Promise<GraphData>;
  compare(params: CompareParams): Promise<CompareResponse>;
  terms(params: FrameworkParams): Promise<TermsResult>;
  term(params: ControlParams): Promise<TermDetail | null>;
}

export function canonicalFrameworkId(value: unknown): FrameworkId {
  const candidate = value === "ce" ? "cyber-essentials" : value;
  if (typeof candidate === "string" && (FRAMEWORK_IDS as readonly string[]).includes(candidate)) {
    return candidate as FrameworkId;
  }
  throw new RangeError(`Unknown Rule1 framework: ${String(value)}`);
}
