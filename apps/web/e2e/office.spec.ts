import type { PricebookListResponse } from "@dwrg/shared";
import { expect, test } from "@playwright/test";
import { DEMO_LOGINS, IPAD_LANDSCAPE, IPAD_PORTRAIT } from "./support/config";
import {
  apiGet,
  demoExport,
  demoExportPath,
  dollars,
  expectNoSidewaysScroll,
  expectTouchTargets,
  fillSignIn,
  findFlaggedCustomer,
  literal,
  signIn,
  statValue,
  usPhone,
} from "./support/helpers";

/** The office app (owner, manager, dispatcher/CSR) at iPad size. */

test.describe("signing in", () => {
  test("goes back to the page asked for, after a wrong password", async ({ page }) => {
    await page.goto("/customers?q=smith");
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByRole("heading", { name: "DWRG Heating & Cooling" })).toBeVisible();
    await expectTouchTargets(page.locator("main"));

    await fillSignIn(page, DEMO_LOGINS.owner.email, "not-the-password");
    await expect(page.getByRole("alert")).toHaveText(
      "That email and password don't match a login.",
    );

    await fillSignIn(page, DEMO_LOGINS.owner.email);
    await expect(page).toHaveURL(/\/customers\?q=smith$/);
    await expect(page.getByRole("heading", { name: "Customers", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Search customers")).toHaveValue("smith");
  });

  test("signing out ends the session", async ({ page }) => {
    await signIn(page, "owner");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/customers");
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });
});

test.describe("customers", () => {
  test("a CSR finds a caller by phone and opens their file", async ({ page }) => {
    await signIn(page, "dispatcher");
    await expect(page).toHaveURL(/\/customers$/);
    const customer = await findFlaggedCustomer(page);
    const phone = customer.contacts.find((c) => c.isPrimary)?.phone ?? customer.contacts[0]?.phone;
    expect(phone, "the demo customer has a phone").toBeTruthy();

    // Typed the way the caller says it.
    await page.getByLabel("Search customers").fill(usPhone(phone as string));
    await expect(page).toHaveURL(/q=/);
    const row = page.getByRole("link", { name: literal(customer.name) });
    await expect(row).toBeVisible();
    await expect(row).toContainText(usPhone(phone as string));
    await row.click();

    await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
    await expect(page.getByRole("heading", { name: customer.name, level: 1 })).toBeVisible();
    await expect(statValue(page, "Open balance")).toHaveText(dollars(customer.openBalanceCents));

    // The replacement flag, in words: on the call, on the location and on the equipment.
    await expect(page.getByText("Replacement flag").first()).toBeVisible();
    const flaggedLocation = customer.locations.find((l) => l.replacementFlag);
    const oldUnit = flaggedLocation?.equipment.find((e) => e.pastReplacementAge);
    expect(oldUnit).toBeDefined();
    const ageText = `${oldUnit?.ageYears} years`;
    const oldRow = page
      .getByRole("row")
      .filter({ hasText: ageText })
      .filter({ hasText: `Older than ${customer.replacementAgeYears} years` });
    await expect(oldRow.first()).toBeVisible();

    await expect(page.getByRole("heading", { name: "Equipment" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Memberships" }).first()).toBeVisible();
    const invoices = page.getByRole("table", { name: "The 10 most recent invoices" });
    if (customer.recentInvoices.length > 0) {
      await expect(invoices.getByRole("row")).toHaveCount(customer.recentInvoices.length + 1);
      const first = customer.recentInvoices[0];
      if (first) await expect(invoices).toContainText(`#${first.number}`);
    }

    await expectNoSidewaysScroll(page);
    await page.setViewportSize(IPAD_LANDSCAPE);
    await expectNoSidewaysScroll(page);

    await page.getByRole("link", { name: "← Customers" }).click();
    // Back to the same results, not an empty search.
    await expect(page).toHaveURL(/\/customers\?q=/);
    await expect(page.getByRole("link", { name: literal(customer.name) })).toBeVisible();
  });

  test("the customer list fits the iPad both ways", async ({ page }) => {
    await signIn(page, "owner");
    await expect(page.getByText(/ customers · page 1 of /)).toBeVisible();
    for (const size of [IPAD_PORTRAIT, IPAD_LANDSCAPE]) {
      await page.setViewportSize(size);
      await expectNoSidewaysScroll(page);
      await expectTouchTargets(page.locator("main"));
    }
  });
});

test.describe("import from ServiceTitan", () => {
  test("detects a demo export, previews it, imports it and proves the totals", async ({ page }) => {
    await signIn(page, "owner");
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Import from ServiceTitan" })).toBeVisible();

    await page.locator("#import-file").setInputFiles(demoExportPath("pricebook.csv"));
    await expect(page.getByText(/^pricebook\.csv · [\d.]+ KB$/)).toBeVisible();
    await page.getByRole("button", { name: "Preview" }).click();

    await expect(page.getByText("Detected from the columns")).toBeVisible();
    await expect(page.getByText("Report:").locator("strong")).toHaveText("Pricebook");
    const rows = demoExport("pricebook.csv").trim().split("\n").length - 1;
    await expect(statValue(page, "Rows in the file")).toHaveText(String(rows));
    await expect(statValue(page, "Will be rejected")).toHaveText("0");
    await expect(page.getByText(/^First 20 rows$/)).toBeVisible();

    await page.getByRole("button", { name: `Import ${rows} rows` }).click();
    await expect(page.getByRole("heading", { name: "4. Import report" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Imported", { exact: true }).first()).toBeVisible();
    await expect(statValue(page, "Rows read")).toHaveText(String(rows));
    await expect(statValue(page, "Rejected")).toHaveText("0");
    const counted = await Promise.all(
      ["New", "Updated", "Unchanged"].map(async (label) =>
        Number(await statValue(page, label).textContent()),
      ),
    );
    expect(counted.reduce((a, b) => a + b, 0)).toBe(rows);

    // The upload is in the history.
    await expect(page.getByRole("link", { name: /pricebook\.csv/ }).first()).toBeVisible();

    // Enter ServiceTitan's own summary (tools/st-import/fixtures/demo/summary.json: 66 items).
    await page.getByRole("link", { name: "Compare with ServiceTitan's summary" }).click();
    await expect(page.getByRole("heading", { name: "Import report", level: 1 })).toBeVisible();
    await page.getByLabel("ServiceTitan count").fill(String(rows));
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByText("Matches ServiceTitan's summary")).toBeVisible();
    await expect(page.getByText("Matches", { exact: true })).toBeVisible();
  });

  test("lists row problems by spreadsheet row before anything is imported", async ({ page }) => {
    await signIn(page, "dispatcher");
    await page.goto("/imports");
    const [header, first, second] = demoExport("customers.csv").split("\n");
    const broken = `${[header, first, second?.replace(",Residential,", ",Martian,")].join("\n")}\n`;
    await page.locator("#import-file").setInputFiles({
      name: "customers-broken.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(broken),
    });
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("Report:").locator("strong")).toHaveText(
      "Customers and locations (with contacts)",
    );
    const problems = page.getByRole("table").filter({ hasText: "Problem" });
    const problem = problems.getByRole("row").filter({ hasText: "Martian" });
    await expect(problem).toContainText("Customer Type");
    await expect(problem.getByRole("cell").first()).toHaveText("3");
  });

  test("says when it can't tell what report a file is", async ({ page }) => {
    await signIn(page, "manager");
    await page.goto("/imports");
    await page.locator("#import-file").setInputFiles({
      name: "something-else.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Color,Shape\nRed,Circle\n"),
    });
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByText("This file can't be imported as it is")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import \d/ })).toHaveCount(0);
  });
});

test.describe("employees", () => {
  test("an owner creates a login, and the new tech can sign in", async ({ page }) => {
    await signIn(page, "owner");
    await page.getByRole("link", { name: "Employees" }).click();
    await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible();
    await expect(page.getByText(DEMO_LOGINS.tech.email)).toBeVisible();

    const stamp = Date.now().toString(36);
    const email = `e2e.tech.${stamp}@e2e.dwrg.example`;
    const name = `Pat Tester ${stamp}`;
    const password = "e2e-password-0123";
    await page.getByRole("button", { name: "Create a login" }).click();
    await page.getByLabel("Full name").fill(name);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Role").selectOption({ label: "Tech" });
    await page.getByLabel("Starting password").fill(password);
    await page.getByRole("checkbox", { name: "HVAC", exact: true }).check();
    await page.getByLabel("Why (kept in the change log)").fill("New hire (e2e test)");
    await page.getByRole("button", { name: "Create login" }).click();
    await expect(page.getByText("Login created")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: email })).toContainText("Tech");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await fillSignIn(page, email, password);
    await expect(page).toHaveURL(/\/tech$/);
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  });

  test("a manager can't make owners, and a CSR can't see Employees", async ({ page }) => {
    await signIn(page, "manager");
    await page.getByRole("link", { name: "Employees" }).click();
    await page.getByRole("button", { name: "Create a login" }).click();
    const roles = await page.getByLabel("Role").locator("option").allTextContents();
    expect(roles).not.toContain("Owner");
    expect(roles).toContain("Tech");
    await page.getByRole("button", { name: "Sign out" }).click();

    await signIn(page, "dispatcher");
    await expect(page.getByRole("navigation", { name: "Main" })).not.toContainText("Employees");
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/customers$/);
  });
});

test.describe("pricebook", () => {
  test("is a read-only list with search and integer-cent prices", async ({ page }) => {
    await signIn(page, "dispatcher");
    const list = await apiGet<PricebookListResponse>(page, "/api/pricebook?pageSize=5");
    const item = list.items[0];
    expect(item).toBeDefined();
    if (!item) return;
    await page.getByRole("link", { name: "Pricebook" }).click();
    await page.getByLabel("Search the pricebook").fill(item.code);
    const row = page.getByRole("row").filter({ hasText: item.name });
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText(dollars(item.priceCents));
    await expect(page.getByRole("button", { name: /edit|delete|save/i })).toHaveCount(0);
  });
});
