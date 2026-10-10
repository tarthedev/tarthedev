import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomerDetail, CustomerListResponse } from "@dwrg/shared";
import { expect, type Locator, type Page } from "@playwright/test";
import { API_ORIGIN, DEMO_EXPORTS_DIR, DEMO_LOGINS, DEMO_PASSWORD, type DemoLogin } from "./config";

/** Fills in the sign-in form (the page must be on /login). */
export async function fillSignIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in as a demo login from the start screen and waits for their home screen. */
export async function signIn(page: Page, who: DemoLogin) {
  await page.goto("/login");
  await fillSignIn(page, DEMO_LOGINS[who].email);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByText(DEMO_LOGINS[who].name, { exact: true })).toBeVisible();
}

/** GET from the API with this page's session cookie (for finding test data). */
export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${API_ORIGIN}${path}`);
  expect(res.ok(), `GET ${path} answered ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

/** The first customer (alphabetically) with equipment past the replacement age. */
export async function findFlaggedCustomer(page: Page): Promise<CustomerDetail> {
  for (let p = 1; p <= 10; p++) {
    const list = await apiGet<CustomerListResponse>(page, `/api/customers?pageSize=50&page=${p}`);
    for (const item of list.items) {
      const detail = await apiGet<CustomerDetail>(page, `/api/customers/${item.id}`);
      if (detail.locations.some((l) => l.replacementFlag)) return detail;
    }
    if (p * 50 >= list.total) break;
  }
  throw new Error("No demo customer has equipment past the replacement age");
}

/** "+17575550116" -> "(757) 555-0116", the way a CSR might type it. */
export function usPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!m) throw new Error(`Not a US phone number: ${e164}`);
  return `(${m[1]}) ${m[2]}-${m[3]}`;
}

/** Integer cents -> "$1,234.56" (integer math, like the app). */
export function dollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String((abs - (abs % 100)) / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** A demo ServiceTitan export (tools/st-import/fixtures/demo). */
export function demoExportPath(name: string): string {
  return join(DEMO_EXPORTS_DIR, name);
}

export function demoExport(name: string): string {
  return readFileSync(demoExportPath(name), "utf8");
}

/** The page fits the screen: nothing scrolls sideways. */
export async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

/**
 * Every visible button, link and form control inside `scope` is a real touch
 * target: at least 44 points tall (Apple's minimum; the app aims for 48).
 */
export async function expectTouchTargets(scope: Locator) {
  const small = await scope
    .locator("button, a[href], input:not([type=checkbox]):not([type=radio]), select, summary")
    .evaluateAll((elements) =>
      elements
        .filter((el) => {
          const style = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            style.visibility !== "hidden" &&
            !el.classList.contains("sr-only")
          );
        })
        .map((el) => ({
          text: (el.textContent ?? el.getAttribute("aria-label") ?? el.tagName).trim().slice(0, 40),
          height: Math.round(el.getBoundingClientRect().height),
        }))
        .filter((t) => t.height < 44),
    );
  expect(small, "touch targets shorter than 44 points").toEqual([]);
}

/** The big number under a label (the app's Stat and count tiles). */
export function statValue(page: Page, label: string): Locator {
  return page.getByText(label, { exact: true }).locator("xpath=following-sibling::p[1]");
}

/** Escapes text for use inside a RegExp. */
export function literal(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
