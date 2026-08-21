/** Shared reactive theme state — synced to `[data-theme]` on `<html>` and cookie on `.link42.app`. */
let current = $state("light");

function setThemeCookie(t: string) {
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API not yet supported in all browsers
  document.cookie = `theme=${t};path=/;domain=.link42.app;max-age=${60 * 60 * 24 * 365};SameSite=Lax`;
}

function getThemeCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)theme=(light|dark)/);
  return match ? match[1] : null;
}

export const theme = {
  get value() {
    return current;
  },
  set value(v: string) {
    current = v;
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", v);
      setThemeCookie(v);
    }
  },
  toggle() {
    this.value = current === "dark" ? "light" : "dark";
  },
  init(serverTheme?: string) {
    if (typeof document !== "undefined") {
      current =
        serverTheme ??
        getThemeCookie() ??
        document.documentElement.getAttribute("data-theme") ??
        (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      document.documentElement.setAttribute("data-theme", current);
    }
  },
};
