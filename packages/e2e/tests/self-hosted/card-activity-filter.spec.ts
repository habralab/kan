import type { Locator } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { CardPage } from "../support/pages/card-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcQuery } from "../support/wait-for-trpc";

async function verticalPosition(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Expected the element to have a bounding box");

  return box.y;
}

async function verticalGap(upper: Locator, lower: Locator) {
  const upperBox = await upper.boundingBox();
  const lowerBox = await lower.boundingBox();
  if (!upperBox || !lowerBox) {
    throw new Error("Expected both elements to have a bounding box");
  }

  return lowerBox.y - (upperBox.y + upperBox.height);
}

test(
  "card activity can be filtered without losing comment controls",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("Activity Filter E2E Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Activity Filter E2E Board");
    await board.createList("To do");
    await board.createCard("Activity filter test card");
    await board.openCard("Activity filter test card");

    const comment = page.getByText("Visible discussion comment", {
      exact: true,
    });
    const systemActivity = page.getByText(/created the card/);
    const commentForm = page
      .getByRole("button", { name: "Submit comment" })
      .locator("xpath=ancestor::form");
    const activityTabs = page.getByRole("tablist", { name: "Activity tabs" });

    const emptyCommentsLoaded = waitForTrpcQuery(page, "card.getActivities");
    await page.getByRole("tab", { name: "Comments", exact: true }).click();
    await emptyCommentsLoaded;
    await expect(commentForm).toBeVisible();
    const oldestEmptyGap = await verticalGap(activityTabs, commentForm);

    const newestEmptyLoaded = waitForTrpcQuery(page, "card.getActivities");
    await page
      .getByRole("button", { name: "Show newest activity first" })
      .click();
    await newestEmptyLoaded;
    await expect(commentForm).toBeVisible();
    expect(
      Math.abs((await verticalGap(activityTabs, commentForm)) - oldestEmptyGap),
    ).toBeLessThanOrEqual(1);

    await page
      .getByRole("button", { name: "Show oldest activity first" })
      .click();
    await page.getByRole("tab", { name: "All", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "All", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await card.addComment("Visible discussion comment");

    await expect(comment).toBeVisible();
    await expect(systemActivity).toBeVisible();

    await page.getByRole("tab", { name: "Comments", exact: true }).click();
    await expect(comment).toBeVisible();
    await expect(systemActivity).toHaveCount(0);
    await expect(commentForm).toBeVisible();

    await page.getByRole("link", { name: "Close" }).click();
    await board.openCard("Activity filter test card");
    await expect(
      page.getByRole("tab", { name: "Comments", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(comment).toBeVisible();
    await expect(systemActivity).toHaveCount(0);

    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await expect(systemActivity).toBeVisible();
    await expect(comment).toHaveCount(0);
    await expect(commentForm).toHaveCount(0);

    await page.getByRole("tab", { name: "All", exact: true }).click();
    await page
      .getByRole("button", { name: "Show newest activity first" })
      .click();
    await expect(comment).toBeVisible();
    await expect(commentForm).toBeVisible();
    expect(await verticalPosition(commentForm)).toBeLessThan(
      await verticalPosition(comment),
    );

    await page
      .getByRole("button", { name: "Show oldest activity first" })
      .click();
    await expect(comment).toBeVisible();
    expect(await verticalPosition(commentForm)).toBeGreaterThan(
      await verticalPosition(comment),
    );
  },
);
