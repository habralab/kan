import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { TimeTrackingPage } from "../support/pages/time-tracking-page";
import { createTestUser } from "../support/test-user";

const setupTimeTrackingCard = async (page: Page) => {
  const user = createTestUser();
  const auth = new AuthPage(page);
  const onboarding = new SelfHostedOnboardingPage(page);
  const dashboard = new DashboardPage(page);
  const board = new BoardPage(page);
  const timeTracking = new TimeTrackingPage(page);

  await auth.signUp(user);
  await onboarding.createFirstWorkspace("Time Tracking Workspace");
  await dashboard.expectSignedInAs(user);
  await board.createBoard("Time Tracking Board");
  await board.createList("In progress");
  await board.createCard("Tracked card");
  await timeTracking.enableForCurrentBoard();
  await board.openCard("Tracked card");

  return { user, timeTracking };
};

test(
  "manual time is reflected on the card, board, and report",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const { user, timeTracking } = await setupTimeTrackingCard(page);

    await timeTracking.addTime({
      member: user.name,
      duration: "1h 30m",
      comment: "Reviewed the implementation",
    });
    await timeTracking.expectCardTotal("1h 30m");

    await page.reload();
    await timeTracking.expectCardTotal("1h 30m");
    await expect(
      page.getByText("Reviewed the implementation", { exact: true }),
    ).toBeVisible();

    await page
      .getByRole("link", { name: "Time Tracking Board", exact: true })
      .click();
    await expect(page.getByText("1h 30m", { exact: true })).toBeVisible();

    const report = await timeTracking.openReport();
    await expect(
      report.getByText("1h 30m", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      report.getByText("Reviewed the implementation", { exact: true }),
    ).toBeVisible();
  },
);

test(
  "a running timer survives reload and creates a worklog when stopped",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const { timeTracking } = await setupTimeTrackingCard(page);

    await timeTracking.startTimer();
    await timeTracking.expectRunningOnCurrentCard();

    await page.reload();
    await timeTracking.expectRunningOnCurrentCard();
    await timeTracking.stopTimer();
    await timeTracking.expectCardTotal("1m");

    await page
      .getByRole("link", { name: "Time Tracking Board", exact: true })
      .click();
    await expect(page.getByText("1m", { exact: true })).toBeVisible();
  },
);
