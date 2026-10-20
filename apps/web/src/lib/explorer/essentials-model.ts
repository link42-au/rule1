export const ESSENTIALS_FRAMEWORK = "asd-essentials-enterprise-it";

export interface SourcePart {
  id?: string;
  name?: string;
  class?: string;
  title?: string;
  prose?: string;
  parts?: SourcePart[];
}

export interface EssentialsDomain {
  id: string;
  description: string;
  phases: string[];
  source: string;
}

export interface EssentialsInfo {
  principles: SourcePart[];
  domains: EssentialsDomain[];
  indicators: SourcePart[];
  additional: SourcePart[];
  techniques: { title: string; url: string }[];
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const objects = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(object) : []);

export const sourceLabel = (value: string): string => value.replaceAll("-", " ").replace(/^./, (s) => s.toUpperCase());

export function essentialsInfo(metadata: Record<string, unknown> | undefined): EssentialsInfo {
  const context = object(metadata?.essentials);
  const raw = object(metadata?.oscal);
  const parts = objects(raw.parts) as SourcePart[];
  return {
    principles: objects(context.ancestors).filter((g) => g.class === "essentials-principle") as SourcePart[],
    domains: objects(context.domains) as unknown as EssentialsDomain[],
    indicators: parts.filter((p) => p.class === "indicators-of-good-practice"),
    additional: parts.filter((p) => !["essentials-action", "indicators-of-good-practice"].includes(p.class ?? "")),
    techniques: objects(context.techniques).flatMap((resource) =>
      objects(resource.rlinks)
        .filter((link) => typeof link.href === "string" && /^https:\/\//.test(link.href))
        .map((link) => ({ title: String(resource.title ?? "Publisher reference"), url: String(link.href) })),
    ),
  };
}

/** Search publisher prose and extension values, including assessment indicators. */
export function essentialsSearchText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata?.essentials) return "";
  const info = essentialsInfo(metadata);
  return JSON.stringify([
    metadata.oscal,
    info.principles,
    info.domains.map(({ id, description, phases }) => ({ id, description, phases })),
  ]).toLowerCase();
}
