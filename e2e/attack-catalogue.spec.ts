import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { copyFile, readFile, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

async function assertNoSeriousAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.filter(({ impact }) => impact === "serious" || impact === "critical")).toEqual([]);
}

async function assertNoDocumentOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
  ).toBe(true);
}

async function routeReviewedFixture(page: Page, testInfo: TestInfo): Promise<void> {
  const fixturePath = testInfo.outputPath("attack-catalogue-fixture.sqlite3");
  await copyFile("apps/web/static/data/rule1.sqlite3", fixturePath);
  const database = new DatabaseSync(fixturePath);
  database.exec(`UPDATE control_attack_mitigation_mappings
    SET status = 'candidate', reviewed_by = NULL, reviewed_at = NULL;
    UPDATE control_attack_mitigation_mappings
    SET status = 'reviewed', reviewed_by = 'playwright-fixture', reviewed_at = '2026-09-07T00:00:00Z'
    WHERE control_id = 'ism-1504' AND mitigation_id = 'M1032';
    PRAGMA foreign_keys = OFF;
    DELETE FROM control_history
      WHERE framework <> 'ism' OR catalog_version <> (
        SELECT version FROM catalog_versions WHERE framework = 'ism' ORDER BY ordinal DESC LIMIT 1
      );
    DELETE FROM control_groups
      WHERE framework <> 'ism' OR catalog_version <> (
        SELECT version FROM catalog_versions WHERE framework = 'ism' ORDER BY ordinal DESC LIMIT 1
      );
    DELETE FROM attack_procedures;
    DELETE FROM attack_procedure_entities;
    VACUUM;`);
  database.close();

  const bytes = await readFile(fixturePath);
  const fixtureStat = await stat(fixturePath);
  const sourceManifest = JSON.parse(
    await readFile("apps/web/static/data/rule1-artifact-manifest.json", "utf8"),
  ) as Record<string, unknown> & { database: Record<string, unknown> };
  const manifest = {
    ...sourceManifest,
    database: {
      ...sourceManifest.database,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size_bytes: fixtureStat.size,
    },
  };

  await page.route("**/data/rule1-artifact-manifest.json**", (route) =>
    route.fulfill({ body: JSON.stringify(manifest), contentType: "application/json" }),
  );
  await page.route("**/data/rule1.sqlite3**", (route) =>
    route.fulfill({ path: fixturePath, contentType: "application/octet-stream" }),
  );
}

test("ATT&CK catalogue searches and filters mapped and unmapped techniques at desktop and phone widths", async ({
  page,
}, testInfo) => {
  await routeReviewedFixture(page, testInfo);

  for (const viewport of [
    { width: 1280, height: 900, label: "desktop" },
    { width: 390, height: 844, label: "phone" },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/attack/?technique=T1021&fixture=${viewport.label}`);
    await expect(page.getByRole("heading", { name: "ATT&CK", level: 1 })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText("ATT&CK 19.2", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Remote Services" })).toBeVisible();
    const techniqueDescription = page.locator("details.description-disclosure");
    await expect(techniqueDescription).not.toHaveAttribute("open", "");
    await expect(techniqueDescription.locator(".technique-description")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Mitigations" })).toBeVisible();
    await expect(page.getByText("Multi-factor Authentication M1032")).toBeVisible();
    await expect(page.getByText("Reviewed ISM controls enabling this mitigation")).toBeVisible();
    const controlLink = page.getByRole("link", { name: /ISM-1504/ });
    await expect(controlLink).toHaveAttribute("href", /explorer\/\?framework=ism&id=ism-1504&tab=attack/);

    const coverage = page.getByRole("button", { name: "Has reviewed ISM controls" });
    await coverage.click();
    await expect(coverage).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/coverage=controls/);
    await expect(page.getByRole("button", { name: /T1021 Remote Services/ })).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    const search = page.getByRole("searchbox", { name: "Search name, ID or description" });
    await search.fill("T1007");
    await expect(page).toHaveURL(/search=T1007/);
    const unmapped = page.getByRole("button", { name: /T1007 System Service Discovery/ });
    await expect(unmapped).toBeVisible();
    await unmapped.click();
    await expect(page.getByRole("heading", { name: "System Service Discovery" })).toBeVisible();
    await expect(page.getByText("MITRE records no Enterprise ATT&CK mitigations for this technique.")).toBeVisible();

    await page.getByRole("button", { name: "Clear filters" }).click();
    await page.getByRole("button", { name: "Execution", exact: true }).click();
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page).toHaveURL(/tactic=execution/);
    await expect(page).toHaveURL(/platform=Windows/);
    if (viewport.label === "desktop") await expect(page.getByText("Filters combine across categories")).toBeVisible();
    await assertNoDocumentOverflow(page);
    await assertNoSeriousAxeViolations(page);

    await page.getByRole("button", { name: "Clear filters" }).click();
    await search.fill("T1021");
    await page.getByRole("button", { name: /T1021 Remote Services/ }).click();
    await page.getByRole("link", { name: /ISM-1504/ }).click();
    await expect(page).toHaveURL(/explorer\/\?framework=ism&id=ism-1504&tab=attack/);
    await expect(page.locator("[data-control-heading]")).toBeVisible();
  }
});
