import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";

async function openSearch(page: Page, boardScoped = false) {
  await page.getByRole("button", { name: "Search", exact: true }).click();
  return page.getByRole("combobox", {
    name: boardScoped
      ? "Search cards on this board"
      : "Search boards and cards",
  });
}

test(
  "boards and cards can be found via the command palette search",
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

    await board.createBoard("Findable Board Xyzzy");
    await board.createList("To do");
    await board.createCard("Locatable Card Plugh");
    await page.goto("/boards");

    const boardSearchInput = await openSearch(page);
    await boardSearchInput.fill("Findable Board");
    const boardOption = page.getByRole("option", { name: /Findable Board/ });
    await expect(boardOption).toBeVisible();
    await boardOption.click();
    await page.waitForURL(/\/boards\/[^/]+$/);

    const cardSearchInput = await openSearch(page, true);
    await cardSearchInput.fill("Locatable Card");
    const cardOption = page.getByRole("option", {
      name: /Locatable Card Plugh/,
    });
    await expect(cardOption).toBeVisible();
    await cardOption.click();
    await page.waitForURL(/\/cards\/[^/]+$/);

    const noResultsSearchInput = await openSearch(page);
    await noResultsSearchInput.fill("zzz-no-such-thing-zzz");
    await expect(
      page.getByText('No results found for "zzz-no-such-thing-zzz".'),
    ).toBeVisible();
  },
);

test(
  "board search starts in the current board and can expand to the workspace",
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

    await board.createBoard("Projects");
    const firstBoardUrl = page.url();
    await board.createList("To do");
    await board.createCard("Northstar: финансовый анализ");
    await board.createCard("Unrelated card");

    await page.goto("/boards");
    await board.createBoard("Other projects");
    await board.createList("To do");
    await board.createCard("Northstar: another board");
    await page.goto(firstBoardUrl);

    await page.getByRole("button", { name: "Search", exact: true }).click();
    const search = page.getByRole("combobox", {
      name: "Search cards on this board",
    });
    await search.fill("Northstar");
    await expect(
      page.getByRole("option", { name: /Northstar: финансовый анализ/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: /Northstar: another board/ }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: "Search all boards in this workspace" })
      .click();
    await expect(
      page.getByRole("option", { name: /Northstar: another board/ }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Search in Projects" }).click();
    await search.fill("финан");
    await expect(
      page.getByRole("option", { name: /Northstar: финансовый анализ/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("link", { name: "Open card Unrelated card" }),
    ).toBeVisible();
  },
);
