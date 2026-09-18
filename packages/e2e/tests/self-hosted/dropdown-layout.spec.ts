import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";

test(
  "translated dropdown actions fit on desktop and stay within a narrow viewport",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);
    await board.createBoard("Dropdown layout test");

    await page.evaluate(() => localStorage.setItem("locale", "ru"));
    await page.reload();

    const optionsButton = page.getByRole("button", {
      name: "Параметры доски",
      exact: true,
    });
    await optionsButton.waitFor();
    await optionsButton.click();

    const longAction = page.getByRole("menuitem", {
      name: "Переместить в рабочее пространство",
      exact: true,
    });
    await expect(longAction).toBeVisible();
    const desktopWhiteSpace = await longAction
      .locator("span")
      .last()
      .evaluate((element) => getComputedStyle(element).whiteSpace);
    expect(desktopWhiteSpace).toBe("nowrap");

    await page.setViewportSize({ width: 320, height: 720 });
    const menu = page.getByRole("menu");
    const menuBox = await menu.boundingBox();
    if (!menuBox) {
      throw new Error("Dropdown menu is not visible at the narrow viewport");
    }
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320);

    const itemBoxes = await page
      .getByRole("menuitem")
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      );
    expect(new Set(itemBoxes.map((width) => Math.round(width))).size).toBe(1);
  },
);
