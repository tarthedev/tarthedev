import { expect, test } from "@playwright/test";
import { IPAD_LANDSCAPE, IPAD_PORTRAIT, WEB_ORIGIN } from "./support/config";
import { expectNoSidewaysScroll, expectTouchTargets, signIn } from "./support/helpers";

/**
 * The techs' iPad app (CLAUDE.md rule 9): a Safari home-screen web app on the
 * iPad (A16), tested at 820 x 1180 in WebKit (CI) and Chromium (locally).
 */

test.describe("tech home", () => {
  test("a tech lands on their home; office screens send them back", async ({ page }) => {
    await signIn(page, "tech");
    await expect(page).toHaveURL(/\/tech$/);
    await expect(page.getByRole("heading", { name: /^Hi, / })).toBeVisible();
    await expect(
      page.getByText("Your scoreboard turns on when the pay plan rolls out after the switch."),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Home", "GPS test"]);

    for (const officePage of ["/customers", "/imports", "/employees", "/pricebook"]) {
      await page.goto(officePage);
      await expect(page).toHaveURL(/\/tech$/);
    }
  });

  test("an installer uses the same field app", async ({ page }) => {
    await signIn(page, "installer");
    await expect(page).toHaveURL(/\/tech$/);
  });

  test("office roles don't land in the field app", async ({ page }) => {
    await signIn(page, "dispatcher");
    await page.goto("/tech");
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("fits the iPad in portrait and landscape with big touch targets", async ({ page }) => {
    await signIn(page, "tech");
    for (const size of [IPAD_PORTRAIT, IPAD_LANDSCAPE]) {
      await page.setViewportSize(size);
      await expectNoSidewaysScroll(page);
      await expectTouchTargets(page.locator("body"));
    }
  });

  test("is set up as a home-screen web app", async ({ page }) => {
    await page.goto("/login");
    const meta = (name: string) =>
      page.locator(`meta[name="${name}"]`).first().getAttribute("content");
    expect(await meta("apple-mobile-web-app-capable")).toBe("yes");
    expect(await meta("apple-mobile-web-app-status-bar-style")).toBe("black-translucent");
    expect(await meta("theme-color")).toBe("#14213D");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
      "href",
      "/apple-touch-icon.png",
    );
    const icon = await page.request.get(`${WEB_ORIGIN}/apple-touch-icon.png`);
    expect(icon.ok()).toBe(true);
    expect(icon.headers()["content-type"]).toContain("image/png");
  });
});

test.describe("GPS test page", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["geolocation"], { origin: WEB_ORIGIN });
    await context.setGeolocation({ latitude: 36.302_1, longitude: -76.224_9, accuracy: 8 });
  });

  test("Start watches the position and shows the live fix", async ({ page, context }) => {
    await signIn(page, "tech");
    await page.getByRole("link", { name: "Open the GPS test" }).click();
    await expect(page).toHaveURL(/\/gps-test$/);
    await expect(page.getByRole("heading", { name: "GPS test", level: 1 })).toBeVisible();
    // Playwright runs in a browser tab, not from the home screen.
    await expect(page.getByText("No, in Safari")).toBeVisible();
    await expect(page.getByText("Tap Start to begin.")).toBeVisible();

    // The test page keeps positions on the iPad: nothing it does may send them anywhere.
    const sent: string[] = [];
    page.on("request", (request) => {
      const body = request.postData() ?? "";
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(request.method());
      if (!readOnly || /36\.3[01]|76\.2[23]/.test(request.url() + body)) {
        sent.push(`${request.method()} ${request.url()}`);
      }
    });

    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByText("Running", { exact: true })).toBeVisible();
    await expect(page.getByText("36.302100", { exact: true })).toBeVisible();
    await expect(page.getByText("-76.224900", { exact: true })).toBeVisible();
    await expect(page.getByText("±8 m", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Last fix \d+ s ago$/)).toBeVisible();
    await expect(page.getByText(/^Last 60 seconds: [1-9]/)).toBeVisible();
    const log = page.locator("pre");
    await expect(log).toContainText("Start tapped: watching position (high accuracy)");
    await expect(log).toContainText("36.302100, -76.224900, ±8 m");

    // The truck moves.
    await context.setGeolocation({ latitude: 36.31, longitude: -76.23, accuracy: 5 });
    await expect(page.getByText("36.310000", { exact: true })).toBeVisible();

    // The screen locks, then comes back: logged, and the watch restarts.
    await page.evaluate(() => {
      const setVisibility = (state: DocumentVisibilityState) => {
        Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      };
      setVisibility("hidden");
      setVisibility("visible");
    });
    await expect(log).toContainText("Page hidden: iPadOS stops location while hidden");
    await expect(log).toContainText("Watch restarted after the page came back");

    await page.getByRole("button", { name: "Copy log" }).click();
    await expect(page.getByText(/^(Copied\.|Couldn't copy\.)/)).toBeVisible();

    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
    await expect(log).toContainText("Stopped");
    expect(sent, "requests that could carry the position").toEqual([]);

    await expectNoSidewaysScroll(page);
    await expectTouchTargets(page.locator("main"));
    await page.setViewportSize(IPAD_LANDSCAPE);
    await expectNoSidewaysScroll(page);
  });

  test("needs a login", async ({ page }) => {
    await page.goto("/gps-test");
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });
});
