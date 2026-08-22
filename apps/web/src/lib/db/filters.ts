import type { Control } from "@rule1/shared";
import type { FrameworkId } from "./contracts";

export type ControlFilter = "all" | "e8" | "ml1" | "ml2" | "ml3" | "changed" | "new" | "withdrawn";

export interface ControlFilterOptions {
  filter?: ControlFilter;
  applicability?: string;
  search?: string;
}

const numericPrefix = (framework: FrameworkId): string | null => {
  if (framework === "cyber-essentials") return "ce";
  if (framework === "ism" || framework === "nzism") return framework;
  return null;
};

export function filterControls(
  controls: readonly Control[],
  framework: FrameworkId,
  options: ControlFilterOptions = {},
): Control[] {
  let result = [...controls];
  const filter = options.filter ?? "all";
  if (filter === "e8") result = result.filter((control) => (control.e8_levels ?? []).length > 0);
  else if (filter.startsWith("ml")) {
    result = result.filter((control) => (control.e8_levels ?? []).includes(filter.toUpperCase()));
  } else if (filter === "changed") result = result.filter((control) => control.change_type === "modified");
  else if (filter === "new" || filter === "withdrawn") {
    result = result.filter((control) => control.change_type === filter);
  } else result = result.filter((control) => control.change_type !== "withdrawn");

  if (options.applicability) {
    result = result.filter((control) => (control.applicability ?? []).includes(options.applicability as string));
  }

  const query = options.search?.trim().toLowerCase();
  if (!query) return result;
  const prefix = numericPrefix(framework);
  if (prefix) {
    const bare = query.replace(new RegExp(`^${prefix}-`), "");
    if (/^\d+$/.test(bare)) {
      const exact = result.find((control) => control.id === `${prefix}-${bare}`);
      if (exact) return [exact];
    }
  }
  return result.filter(
    (control) =>
      control.display_id.toLowerCase().includes(query) || (control.statement ?? "").toLowerCase().includes(query),
  );
}
