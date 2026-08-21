/** Browser-local theme state shared by the standalone Rule1 shell. */
export type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
let current = $state<Theme>("light");

function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(value: Theme, persist: boolean): void {
  current = value;
  document.documentElement.setAttribute("data-theme", value);
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The visible theme still works when browser storage is unavailable.
  }
}

export const theme = {
  get value(): Theme {
    return current;
  },
  set value(value: Theme) {
    if (typeof document !== "undefined") applyTheme(value, true);
    else current = value;
  },
  toggle(): void {
    this.value = current === "dark" ? "light" : "dark";
  },
  init(): void {
    if (typeof document === "undefined") return;
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    applyTheme(readStoredTheme() ?? systemTheme, false);
  },
};
