import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

test(
  "a card can be completed from the board without opening it",
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

    await board.createBoard("Completion test board");
    await board.createList("To do");
    await board.createCard("Complete from board");

    const boardUrl = page.url();
    const cardLink = page.getByRole("link", {
      name: "Open card Complete from board",
      exact: true,
    });
    const card = cardLink.locator("..");
    await card.hover();

    const markComplete = card.getByRole("button", {
      name: "Mark card as complete",
      exact: true,
    });
    await expect(markComplete).toHaveCSS("opacity", "1");
    await expect(markComplete).toHaveCSS("cursor", "pointer");

    const completionBox = await markComplete.boundingBox();
    const titleBox = await card.getByText("Complete from board").boundingBox();
    expect(completionBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(
      Math.abs(
        (completionBox?.y ?? 0) +
          (completionBox?.height ?? 0) / 2 -
          ((titleBox?.y ?? 0) + 10),
      ),
    ).toBeLessThanOrEqual(2);

    const completed = waitForTrpcMutation(page, "card.update");
    await markComplete.click();

    await expect(page).toHaveURL(boardUrl);
    const markIncomplete = card.getByRole("button", {
      name: "Mark card as incomplete",
      exact: true,
    });
    await expect(markIncomplete).toBeVisible();
    await completed;

    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Mark card as incomplete",
        exact: true,
      }),
    ).toBeVisible();
  },
);
