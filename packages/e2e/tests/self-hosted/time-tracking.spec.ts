import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { MembersPage } from "../support/pages/members-page";
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

const localDate = (daysFromToday: number) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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
    await timeTracking.showTimeEntries();
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

    const period = report.getByRole("combobox", {
      name: "Period",
      exact: true,
    });
    const fromDate = report.getByLabel("From", { exact: true });
    const toDate = report.getByLabel("To", { exact: true });
    const entriesExport = report.getByRole("link", {
      name: "Export entries CSV",
      exact: true,
    });

    await period.selectOption({ label: "All time" });
    await expect(fromDate).toHaveValue("");
    await expect(toDate).toHaveValue("");
    await expect(entriesExport).not.toHaveAttribute("href", /dateFrom|dateTo/);

    await period.selectOption({ label: "Today" });
    await expect(fromDate).toHaveValue(localDate(0));
    await expect(toDate).toHaveValue(localDate(0));
    await expect(entriesExport).toHaveAttribute("href", /dateFrom=.*dateTo=/);
    await fromDate.fill(localDate(-1));
    await expect(period).toHaveValue("custom");
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

test(
  "period presets update the card total and visible entries",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const { user, timeTracking } = await setupTimeTrackingCard(page);

    await timeTracking.addTime({
      member: user.name,
      duration: "1h",
      date: localDate(0),
      comment: "Today entry",
    });
    await timeTracking.addTime({
      member: user.name,
      duration: "2h",
      date: localDate(-1),
      comment: "Yesterday entry",
    });
    await timeTracking.expectCardTotal("3h");
    await timeTracking.showTimeEntries();
    await timeTracking.expectEntry("Today entry");
    await timeTracking.expectEntry("Yesterday entry");

    await timeTracking.selectPeriod("Today");
    await timeTracking.expectCardTotal("1h");
    await timeTracking.expectEntry("Today entry");
    await timeTracking.expectEntry("Yesterday entry", false);
  },
);

test(
  "member chips filter entries without changing the card total",
  { tag: "@self-hosted" },
  async ({ page, browser }) => {
    test.setTimeout(60_000);
    const { user, timeTracking } = await setupTimeTrackingCard(page);
    const cardUrl = page.url();
    const members = new MembersPage(page);

    await members.open();
    const inviteLink = await members.createInviteLink();

    const secondUserContext = await browser.newContext();
    const secondUserPage = await secondUserContext.newPage();
    const secondUser = {
      ...createTestUser(),
      name: "E2E Second User",
    };
    const secondUserAuth = new AuthPage(secondUserPage);
    await secondUserAuth.signUp(secondUser);
    await secondUserPage.goto(inviteLink);
    await secondUserPage.waitForURL(/\/boards\?workspacePublicId=/, {
      timeout: 20_000,
    });
    await secondUserContext.close();

    await page.goto(cardUrl);
    await timeTracking.addTime({
      member: user.name,
      duration: "1h",
      comment: "Owner entry",
    });
    await timeTracking.addTime({
      member: secondUser.name,
      duration: "2h",
      comment: "Second member entry",
    });
    await timeTracking.expectCardTotal("3h");
    await timeTracking.showTimeEntries();
    await timeTracking.expectEntry("Owner entry");
    await timeTracking.expectEntry("Second member entry");

    await timeTracking.toggleMemberFilter(user.name, "1h", true);
    await timeTracking.expectCardTotal("3h");
    await timeTracking.expectEntry("Owner entry");
    await timeTracking.expectEntry("Second member entry", false);

    await timeTracking.toggleMemberFilter(user.name, "1h", false);
    await timeTracking.expectEntry("Owner entry");
    await timeTracking.expectEntry("Second member entry");
  },
);
