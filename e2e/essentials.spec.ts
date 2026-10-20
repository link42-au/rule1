import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const framework = "asd-essentials-enterprise-it";

async function waitForCatalogue(page: Page): Promise<void> {
  // Frameworks are available only after the checked local database has opened.
  // Match the existing startup allowance without extending content assertions or test limits.
  await expect(page.getByRole("button", { name: "ASD Essentials", exact: true })).toBeVisible({ timeout: 90_000 });
}

test("Essentials retains domains, phases, principles and ordered indicators at desktop and phone widths", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/explorer/?framework=${framework}&id=IT.GOV-01.1`);
    const overview = page.locator(".essentials-overview");
    await waitForCatalogue(page);
    await expect(overview).toBeVisible();
    await expect(overview.getByRole("heading", { name: /Principle.*GOV-01/ })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Action · IT.GOV-01.1" })).toBeVisible();
    await expect(overview.getByRole("heading", { name: "Governance and culture", exact: true })).toBeVisible();
    await expect(overview.locator(".phases").first()).toHaveText(/Phase 1.*Phase 2.*Phase 3/);
    await expect(overview.locator(".indicator-group h3")).toHaveText([
      "Not effective",
      "Partially effective",
      "Fully effective",
    ]);
    await expect(overview.locator(".indicator-group li").first()).toContainText("IT.GOV-01.1.NE-1");
    const dimensions = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  }
});

test("Essentials search, domain filters and single-version Compare work without ISM mappings", async ({ page }) => {
  await page.goto(`/explorer/?framework=${framework}&id=IT.GOV-01.1`);
  const domain = page.getByRole("combobox", { name: "Essentials domain" });
  await waitForCatalogue(page);
  await expect(domain).toBeVisible();
  await expect(page.locator(".sidebar-section-label")).toHaveText(/Actions list.*58/);
  await domain.selectOption("identity-services");
  await expect(page).not.toHaveURL(/(?:[?&])id=/);
  await expect(page.locator(".sidebar-section-label")).not.toHaveText(/58/);
  await page.goto(`/explorer/?framework=${framework}&search=IT.GOV-01.1`);
  await expect(page.locator("[data-control-heading]")).toHaveText("IT.GOV-01.1");
  await expect(page.getByRole("tab", { name: "ATT&CK" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Changelog", exact: true }).click();
  await expect(page.locator(".timeline-entry")).toHaveCount(1);
  await expect(page.locator(".timeline-entry")).toContainText("2026.10.15");
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(page.getByText("No related controls are retained in the same section.")).toBeVisible();
  await page.goto(`/compare/?framework=${framework}`);
  await expect(page.getByText("ASD Essentials needs at least two retained versions for comparison.")).toBeVisible();
  await page.getByRole("button", { name: /^ISM/ }).click();
  await expect(page.getByRole("combobox", { name: "From", exact: true })).toBeVisible();
});
