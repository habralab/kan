import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

test(
  "cards and lists can be moved after the board drag-and-drop upgrade",
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

    await board.createBoard("Drag and drop board");
    await board.createList("To do");
    await board.createList("Done");
    await board.createCard("Move me", "To do");

    const lists = page.locator(
      '[data-board-draggable]:has(input[aria-label="List name"])',
    );
    const movedCard = waitForTrpcMutation(page, "card.update");
    await page
      .getByRole("link", { name: "Open card Move me", exact: true })
      .dragTo(lists.nth(1).locator("[data-list-scroll-id]"), { steps: 20 });
    await movedCard;
    await expect(
      lists.nth(1).getByText("Move me", { exact: true }),
    ).toBeVisible();

    const movedList = waitForTrpcMutation(page, "list.update");
    await lists.nth(0).dragTo(lists.nth(1), {
      sourcePosition: { x: 100, y: 20 },
      targetPosition: { x: 100, y: 20 },
      steps: 20,
    });
    await movedList;
    await page.reload();

    await expect(
      lists.nth(0).getByRole("textbox", { name: "List name" }),
    ).toHaveValue("Done");
    await expect(
      lists.nth(0).getByText("Move me", { exact: true }),
    ).toBeVisible();
  },
);
