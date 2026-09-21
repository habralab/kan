import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { CardPage } from "../support/pages/card-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import {
  waitForTrpcMutation,
  waitForTrpcQuery,
} from "../support/wait-for-trpc";

async function selectBoardFilter(page: Page, group: string, value: string) {
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page
    .getByRole("menuitem", { name: new RegExp(`^${group}(?: \\d+)?$`) })
    .click();
  const updated = waitForTrpcQuery(page, "board.byId");
  await page
    .getByRole("checkbox", { name: value, exact: true })
    .filter({ visible: true })
    .click();
  await updated;
  await page.keyboard.press("Escape");
  if (await page.getByRole("menu", { name: "Filter" }).isVisible()) {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByRole("menu", { name: "Filter" })).toHaveCount(0);
}

test(
  "board filters intersect categories, match any value within a category, and show no cards on a miss",
  { tag: "@self-hosted" },
  async ({ page }) => {
    test.setTimeout(90_000);
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Filter intersection board");
    const boardUrl = page.url();
    await board.createList("To do");
    for (const title of ["Both", "Label only", "Member only", "Neither"]) {
      await board.createCard(title);
    }

    await board.openCard("Both");
    await card.createAndAssignLabel("Urgent");
    await card.assignMember(user.name);
    await page.goto(boardUrl);

    await board.openCard("Label only");
    await page
      .locator('[aria-label="Labels"]')
      .filter({ visible: true })
      .click();
    const assigned = waitForTrpcMutation(page, "card.addOrRemoveLabel");
    await page
      .getByRole("checkbox", { name: "Urgent", exact: true })
      .filter({ visible: true })
      .click();
    await assigned;
    await page.keyboard.press("Escape");
    await card.createAndAssignLabel("Solo");
    await page.goto(boardUrl);

    await board.openCard("Member only");
    await card.assignMember(user.name);
    await page.goto(boardUrl);

    await selectBoardFilter(page, "Labels", "Urgent");
    await expect(page.getByText("Both", { exact: true })).toBeVisible();
    await expect(page.getByText("Label only", { exact: true })).toBeVisible();
    await expect(page.getByText("Member only", { exact: true })).toHaveCount(0);

    await selectBoardFilter(page, "Members", user.name);
    await expect(page.getByText("Both", { exact: true })).toBeVisible();
    await expect(page.getByText("Label only", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Member only", { exact: true })).toHaveCount(0);

    await selectBoardFilter(page, "Labels", "Solo");
    await expect(page.getByText("Both", { exact: true })).toBeVisible();

    await selectBoardFilter(page, "Labels", "Urgent");
    for (const title of ["Both", "Label only", "Member only", "Neither"]) {
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    }

    const boardPublicId = new URL(boardUrl).pathname.split("/").at(-1);
    if (!boardPublicId) throw new Error("Could not resolve board ID");
    for (const filters of [
      { labels: ["missing00000"], members: [] },
      { labels: [], members: ["missing00000"] },
    ]) {
      const input = new URLSearchParams({
        batch: "1",
        input: JSON.stringify({
          0: { json: { boardPublicId, ...filters, lists: [] } },
        }),
      });
      const response = await page.request.get(`/api/trpc/board.byId?${input}`);
      expect(response.ok()).toBe(true);
      const body = (await response.json()) as [
        {
          result: {
            data: { json: { lists: { cards: unknown[] }[] } };
          };
        },
      ];
      expect(
        body[0].result.data.json.lists.flatMap((list) => list.cards),
      ).toHaveLength(0);
    }
  },
);

test(
  "the board view can be filtered by label",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("E2E Test Board");
    await board.createList("To do");
    await board.createCard("Labeled card");
    await board.createCard("Unlabeled card");

    await board.openCard("Labeled card");
    await card.createAndAssignLabel("Urgent");
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL(/\/boards\/[^/]+$/);

    await expect(page.getByText("Labeled card", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Unlabeled card", { exact: true }),
    ).toBeVisible();

    await board.filterByLabel("Urgent");

    await expect(page.getByText("Labeled card", { exact: true })).toBeVisible();
    await expect(page.getByText("Unlabeled card", { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByRole("menu")).toHaveCount(0);

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Labels 1", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Labels 1", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Urgent", exact: true }),
    ).toBeChecked();

    await page
      .getByRole("menuitem", { name: "Clear filters", exact: true })
      .click();

    await expect(page.getByText("Labeled card", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Unlabeled card", { exact: true }),
    ).toBeVisible();
  },
);

test(
  "closing a card preserves the board label filter",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Filtered board");
    await board.createList("To do");
    await board.createCard("Matching card");
    await board.createCard("Nonmatching card");

    await board.openCard("Matching card");
    await page.waitForURL((url) => url.pathname.startsWith("/cards/"));
    const labelPublicId = await card.createAndAssignLabel("Urgent");
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));

    await board.filterByLabel("Urgent");
    const expectedBoardUrl = new URL(page.url());
    expectedBoardUrl.search = new URLSearchParams({
      labels: labelPublicId,
    }).toString();

    await expect(page).toHaveURL(expectedBoardUrl.toString());
    await expect(
      page.getByText("Matching card", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Nonmatching card", { exact: true }),
    ).toHaveCount(0);

    await board.openCard("Matching card");
    await page.waitForURL((url) => url.pathname.startsWith("/cards/"));
    expect(new URL(page.url()).searchParams.get("returnUrl")).toBe(
      `${expectedBoardUrl.pathname}${expectedBoardUrl.search}`,
    );
    await page
      .getByRole("link", { name: "Filtered board", exact: true })
      .click();
    await page.waitForURL(expectedBoardUrl.toString());

    await expect(
      page.getByText("Nonmatching card", { exact: true }),
    ).toHaveCount(0);

    await board.openCard("Matching card");
    await page.waitForURL((url) => url.pathname.startsWith("/cards/"));
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL(expectedBoardUrl.toString());

    await expect(
      page.getByText("Matching card", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Nonmatching card", { exact: true }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "Labels 1", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Labels 1", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "Urgent", exact: true }),
    ).toBeChecked();
  },
);

test(
  "closing a directly opened card returns to the plain board",
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

    await board.createBoard("Direct card board");
    await board.createList("To do");
    await board.createCard("Direct card");

    const cardHref = await page
      .getByRole("link", { name: "Open card Direct card" })
      .getAttribute("href");
    expect(cardHref).toMatch(/^\/cards\/[^?]+$/);
    if (!cardHref) throw new Error("Could not find direct card link");
    await page.goto(cardHref);
    await page.waitForURL((url) => url.pathname.startsWith("/cards/"));
    await page.getByRole("link", { name: "Close" }).click();

    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));
    expect(new URL(page.url()).search).toBe("");
  },
);
