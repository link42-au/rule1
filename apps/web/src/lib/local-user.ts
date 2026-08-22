import type { ControlDetail } from "@rule1/shared";

export const FAVOURITES_STORAGE_KEY = "ism-favourites";
const CONTROL_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const MAX_FAVOURITES = 10_000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredFavourites {
  favourites: Set<string>;
  recovered: boolean;
}

function validatedIds(value: unknown): string[] {
  const candidate = Array.isArray(value)
    ? value
    : typeof value === "object" && value !== null && "favourites" in value
      ? (value as { favourites: unknown }).favourites
      : null;
  if (!Array.isArray(candidate)) throw new Error("Expected a favourites array.");
  if (candidate.length > MAX_FAVOURITES) throw new Error("The favourites file is too large.");
  if (!candidate.every((id) => typeof id === "string" && CONTROL_ID_PATTERN.test(id))) {
    throw new Error("Every favourite must be a valid control ID.");
  }
  return [...new Set(candidate.map((id) => id.toLowerCase()))].sort();
}

export function loadFavourites(storage?: StorageLike): StoredFavourites {
  if (!storage) return { favourites: new Set(), recovered: true };
  try {
    const raw = storage.getItem(FAVOURITES_STORAGE_KEY);
    if (!raw) return { favourites: new Set(), recovered: false };
    return { favourites: new Set(validatedIds(JSON.parse(raw))), recovered: false };
  } catch {
    return { favourites: new Set(), recovered: true };
  }
}

export function saveFavourites(storage: StorageLike | undefined, favourites: ReadonlySet<string>): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FAVOURITES_STORAGE_KEY, JSON.stringify([...favourites].sort()));
    return true;
  } catch {
    return false;
  }
}

export function exportFavourites(favourites: ReadonlySet<string>): string {
  // Keep the old array shape so existing Rule1 exports remain round-trip compatible.
  return JSON.stringify([...favourites].sort(), null, 2);
}

export function importFavourites(current: ReadonlySet<string>, json: string): Set<string> {
  const imported = validatedIds(JSON.parse(json));
  return new Set([...current, ...imported]);
}

function flatten(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function csvCell(value: string): string {
  const safe = flatten(value);
  const formulaSafe = /^[=+@-]/.test(safe) ? `'${safe}` : safe;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

export function controlCsv(control: ControlDetail): string {
  const header = [
    "Framework",
    "ID",
    "Version",
    "Section",
    "Change Type",
    "Applicability",
    "Essential Eight",
    "Description",
  ];
  const row = [
    control.framework,
    control.display_id,
    control.latest.catalog_version ?? "",
    control.section ?? "",
    control.latest.change_type ?? "",
    (control.latest.applicability ?? []).join("; "),
    (control.latest.e8_levels ?? []).join("; "),
    control.latest.statement ?? "",
  ];
  return `\uFEFF${header.join(",")}\r\n${row.map(csvCell).join(",")}\r\n`;
}

export function controlJson(control: ControlDetail): string {
  return JSON.stringify(
    {
      framework: control.framework,
      id: control.id,
      display_id: control.display_id,
      title: control.title ?? null,
      section: control.section ?? null,
      latest: control.latest,
    },
    null,
    2,
  );
}

function markdownText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, "  \n");
}

export function controlMarkdown(control: ControlDetail): string {
  const title = markdownText(control.title ?? control.display_id);
  const statement = markdownText(control.latest.statement ?? "No description retained.");
  const metadata = [
    ["Framework", control.framework],
    ["Control", control.display_id],
    ["Version", control.latest.catalog_version ?? "Unknown"],
    ["Section", control.section ?? "Unknown"],
    ["Applicability", (control.latest.applicability ?? []).join(", ") || "None retained"],
    ["Essential Eight", (control.latest.e8_levels ?? []).join(", ") || "No mapping retained"],
  ];
  return [
    `# ${title}`,
    "",
    ...metadata.map(([key, value]) => `- **${key}:** ${markdownText(value)}`),
    "",
    statement,
    "",
  ].join("\n");
}
