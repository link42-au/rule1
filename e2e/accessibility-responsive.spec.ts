import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function assertNoSeriousAxeViolations(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const reportable = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  if (reportable.length > 0) {
    await testInfo.attach(`axe-${label}`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
  }
  expect(reportable, `${label} has serious or critical automated accessibility violations`).toEqual([]);
}

async function assertDocumentDoesNotOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function selectTheme(page: Page, value: "light" | "dark"): Promise<void> {
  await page.evaluate((theme) => {
    localStorage.setItem("theme", theme);
  }, value);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", value);
}

test("primary navigation renders in Geist sans while the platform bar remains Geist Mono", async ({ page }) => {
  await page.goto("/guide/");
  await expect(page.getByRole("heading", { name: "Rule1 guide" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.check('13px "Geist"'))).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fonts.check('10px "Geist Mono"'))).toBe(true);

  const desktopPrimaryFamily = await page
    .locator(".nav-link")
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  const platformAppFamily = await page
    .locator(".pb-app")
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  const platformMoreFamily = await page
    .locator(".pb-more-trigger")
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(desktopPrimaryFamily).toContain("Geist");
  expect(desktopPrimaryFamily).not.toContain("Geist Mono");
  expect(platformAppFamily).toContain("Geist Mono");
  expect(platformMoreFamily).toContain("Geist Mono");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Toggle menu" }).click();
  const mobilePrimaryFamily = await page
    .locator(".nav-mobile-link")
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(mobilePrimaryFamily).toContain("Geist");
  expect(mobilePrimaryFamily).not.toContain("Geist Mono");
});

test("static routes reflow across representative viewports and themes", async ({ page }, testInfo) => {
  await page.goto("/guide/");
  await selectTheme(page, "light");
  await expect(page.getByRole("heading", { name: "Rule1 guide" })).toBeVisible();
  await assertDocumentDoesNotOverflow(page);
  await assertNoSeriousAxeViolations(page, testInfo, "guide-light-desktop");

  await selectTheme(page, "dark");
  await assertNoSeriousAxeViolations(page, testInfo, "guide-dark-desktop");

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/privacy/");
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await assertDocumentDoesNotOverflow(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Toggle menu" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle menu" }).click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeVisible();
  await assertDocumentDoesNotOverflow(page);
  await assertNoSeriousAxeViolations(page, testInfo, "privacy-mobile-menu-dark");

  // 640 and 320 CSS pixels are stable reflow proxies for 200% and 400% zoom
  // on a 1280-pixel-wide desktop viewport. Actual browser zoom remains a
  // manual acceptance check because Playwright exposes no portable zoom API.
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
    await assertDocumentDoesNotOverflow(page);
  }
});

test("catalogue splash and loaded interactions remain accessible and locally contained", async ({ page }, testInfo) => {
  let releaseDatabase!: () => void;
  const databaseGate = new Promise<void>((resolve) => {
    releaseDatabase = resolve;
  });
  let databaseRequested = false;

  await page.route("**/data/rule1.sqlite3", async (route) => {
    databaseRequested = true;
    await databaseGate;
    await route.continue();
  });

  await page.goto("/guide/");
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/explorer/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const splash = page.locator(".database-splash");
  await expect(splash).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => databaseRequested).toBe(true);
  await assertNoSeriousAxeViolations(page, testInfo, "database-splash-mobile");

  releaseDatabase();
  await expect(splash).toBeHidden({ timeout: 90_000 });
  await expect(page.getByText("Controls list")).toBeVisible();
  await assertDocumentDoesNotOverflow(page);

  await page.getByRole("button", { name: "Toggle menu" }).click();
  const mobileSearch = page.getByRole("searchbox", { name: "Search" });
  await mobileSearch.fill("ism-0009");
  await page.getByRole("button", { name: "Search", exact: true }).evaluate((button) => {
    const form = button.closest("form");
    if (!form) throw new Error("Mobile search form is unavailable.");
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.locator("[data-control-heading]")).toBeVisible();
  await expect(page).toHaveURL(/id=ism-0009/);
  await page.getByRole("button", { name: "Back to controls" }).click();

  await page.getByRole("button", { name: /^ISM-0009 / }).click();
  await expect(page.getByRole("button", { name: "Back to controls" })).toBeVisible();
  await expect(page.locator("[data-control-heading]")).toBeFocused();
  await assertNoSeriousAxeViolations(page, testInfo, "explorer-mobile-detail-light");
  await page.getByRole("button", { name: "Back to controls" }).click();
  await expect(page.getByText("Controls list")).toBeVisible();

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/explorer/?id=ism-0009");
  await expect(page.locator("[data-control-heading]")).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Control detail views" });
  await tabs.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Changelog" })).toHaveAttribute("aria-selected", "true");
  await assertDocumentDoesNotOverflow(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  const separator = page.getByRole("separator", { name: "Resize control navigation" });
  await expect(separator).toBeVisible();
  const originalWidth = Number(await separator.getAttribute("aria-valuenow"));
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", String(originalWidth + 16));

  await selectTheme(page, "dark");
  await expect(page.locator("[data-control-heading]")).toBeVisible();
  await assertNoSeriousAxeViolations(page, testInfo, "explorer-dark-desktop");

  await page.goto("/compare/?from=ISM-OSCAL-2026.03.24&to=ISM-OSCAL-2026.06.18");
  const results = page.getByRole("region", { name: "Comparison results" });
  await expect(results).toBeVisible();
  await expect(results.getByRole("table")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertDocumentDoesNotOverflow(page);
  const overflow = await results.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  await assertNoSeriousAxeViolations(page, testInfo, "compare-mobile-dark");
});

test("AI Summary switches between factual and Professional descriptions and remembers the preference", async ({
  page,
}) => {
  await page.goto("/guide/");
  await page.evaluate(() => localStorage.removeItem("ai-flavour"));
  await page.goto("/explorer/?framework=ism&id=ism-0009");
  await expect(page.locator("[data-control-heading]")).toBeVisible({ timeout: 90_000 });

  const flavour = page.getByRole("group", { name: "AI summary flavour" });
  const summary = page.locator(".ai-summary-block");
  await expect(flavour).toBeVisible();
  await expect(flavour.getByRole("button", { name: "Factual" })).toHaveAttribute("aria-pressed", "true");
  const factual = await summary.innerText();
  expect(factual.trim()).not.toBe("");

  await flavour.getByRole("button", { name: "Professional" }).click();
  await expect(flavour.getByRole("button", { name: "Professional" })).toHaveAttribute("aria-pressed", "true");
  const professional = await summary.innerText();
  expect(professional.trim()).not.toBe("");
  expect(professional).not.toBe(factual);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("ai-flavour"))).toBe("snarky");

  await page.reload();
  await expect(page.locator("[data-control-heading]")).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("group", { name: "AI summary flavour" }).getByRole("button", { name: "Professional" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".ai-summary-block")).toHaveText(professional);
});

test("ATT&CK control mappings are ISM-only, local, and honestly empty at desktop and phone widths", async ({
  page,
}, testInfo) => {
  const backendRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.hostname !== "127.0.0.1") backendRequests.push(request.url());
  });

  for (const viewport of [
    { width: 1280, height: 900, label: "desktop" },
    { width: 390, height: 844, label: "phone" },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/explorer/?framework=ism&id=ism-1173&tab=attack");
    await expect(page.locator("[data-control-heading]")).toBeVisible({ timeout: 90_000 });
    const attackTab = page.getByRole("tab", { name: "ATT&CK" });
    await expect(attackTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "MITRE ATT&CK mappings" })).toBeVisible();
    await expect(page.getByText(/may prevent, constrain, detect, contain, or support recovery/)).toBeVisible();
    await expect(page.getByText("No reviewed ATT&CK mappings", { exact: true })).toBeVisible();
    await expect(page.getByText("ATT&CK 19.2", { exact: true })).toBeVisible();
    await expect(page.getByText("ISM ISM-OSCAL-2026.09.4", { exact: true })).toBeVisible();
    await assertDocumentDoesNotOverflow(page);
    await assertNoSeriousAxeViolations(page, testInfo, `attack-empty-${viewport.label}`);
  }

  await page.goto("/explorer/?framework=nzism&id=nzism-127&tab=attack");
  await expect(page.locator("[data-control-heading]")).toBeVisible();
  await expect(page.getByRole("tab", { name: "ATT&CK" })).toHaveCount(0);
  await expect(page).not.toHaveURL(/tab=attack/);
  expect(backendRequests).toEqual([]);
});
