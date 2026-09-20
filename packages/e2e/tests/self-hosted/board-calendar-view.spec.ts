import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { CalendarPage, toDateKey } from "../support/pages/calendar-page";
import { CardPage } from "../support/pages/card-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

test(
  "the calendar view shows cards on their due date and hides cards without one",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Test Board");
    await board.createList("To do");
    await board.createCard("Due today");
    await board.createCard("No due date");

    await board.openCard("Due today");
    const today = await card.setDueDateToday();
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));

    await calendar.open();
    await calendar.expectCardOnDate("Due today", today);
    await expect(page.getByText("No due date", { exact: true })).toHaveCount(0);

    await calendar.openLists();
    await expect(
      page.getByText("Due today", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No due date", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
  },
);

test(
  "the calendar view shows a card on every day of its date range",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Range Board");
    await board.createList("To do");
    await board.createCard("Three-day task");

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 10);
    const secondDay = new Date(today.getFullYear(), today.getMonth(), 11);
    const lastDay = new Date(today.getFullYear(), today.getMonth(), 12);

    await board.openCard("Three-day task");
    await card.setDateRange(toDateKey(firstDay), toDateKey(lastDay));
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));

    await calendar.open();
    await calendar.expectCardOnDate("Three-day task", firstDay);
    await calendar.expectCardOnDate("Three-day task", secondDay);
    await calendar.expectCardOnDate("Three-day task", lastDay);
  },
);

test(
  "the calendar can expand a busy day to reach every card",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Busy Day Board");
    await board.createList("To do");
    await calendar.open();

    const today = new Date();
    const targetDate = new Date(today.getFullYear(), today.getMonth(), 10);
    for (let index = 1; index <= 4; index++) {
      await calendar.createCardOnDate(targetDate, `Scheduled card ${index}`);
    }

    const day = page
      .locator(`time[datetime="${toDateKey(targetDate)}"]`)
      .filter({ visible: true })
      .locator("..");
    await expect(day.locator("ol > li > a")).toHaveCount(3);
    await day.getByRole("button", { name: "+ 1 more" }).click();
    await expect(day.locator("ol > li > a")).toHaveCount(4);
    for (let index = 1; index <= 4; index++) {
      await expect(day.getByText(`Scheduled card ${index}`)).toBeVisible();
    }
  },
);

test(
  "the calendar shows due checklist items without requiring a card deadline",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Checklist Board");
    await board.createList("To do");
    await board.createCard("Plan the route");
    await board.openCard("Plan the route");
    await card.createChecklist("Preparation");
    await card.addChecklistItem("Check the maps");

    const itemRow = page
      .locator(".plain-text-editor")
      .filter({ hasText: "Check the maps" })
      .locator("xpath=ancestor::div[contains(@class, 'items-start')][1]");
    await itemRow
      .getByRole("button", { name: "Set checklist item due date" })
      .click();
    const today = new Date();
    await page
      .locator(`time[datetime="${toDateKey(today)}"]`)
      .filter({ visible: true })
      .click();
    const updated = waitForTrpcMutation(page, "checklist.updateItem");
    await itemRow.getByRole("button", { name: "Save" }).click();
    await updated;

    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));
    await calendar.open();
    await calendar.expectCardOnDate("Check the maps", today);
    await expect(
      page.getByRole("link", { name: "Plan the route", exact: true }),
    ).toHaveCount(0);
  },
);

test(
  "clicking a date on the calendar creates a card with that due date",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Create Board");
    await board.createList("To do");

    await calendar.open();

    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() <= 15 ? 20 : 10);

    await calendar.createCardOnDate(targetDate, "Scheduled card");
    await calendar.expectCardOnDate("Scheduled card", targetDate);

    const cardHref = await page
      .locator('a[href^="/cards/"]')
      .filter({ has: page.getByText("Scheduled card", { exact: true }) })
      .filter({ visible: true })
      .getAttribute("href");
    if (!cardHref) throw new Error("Could not find created calendar card link");
    const cardPublicId = cardHref.split("/cards/")[1]?.split("?")[0];

    const cardResponse = await page.request.get(
      `/api/trpc/card.byId?batch=1&input=${encodeURIComponent(
        JSON.stringify({ "0": { json: { cardPublicId } } }),
      )}`,
    );
    const cardBody = (await cardResponse.json()) as [
      { result: { data: { json: { dueDate: string | null } } } },
    ];
    const dueDate = cardBody[0].result.data.json.dueDate;
    expect(dueDate ? toDateKey(new Date(dueDate)) : null).toBe(
      toDateKey(targetDate),
    );
  },
);

test(
  "the mobile calendar keeps card and timed checklist dates reachable",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const card = new CardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Mobile Calendar Board");
    await board.createList("To do");
    await board.createCard("Plan the route");
    await board.openCard("Plan the route");
    const today = await card.setDueDateToday();
    await card.createChecklist("Preparation");
    await card.addChecklistItem("Contact the guide");

    const itemRow = page
      .locator(".plain-text-editor")
      .filter({ hasText: "Contact the guide" })
      .locator("xpath=ancestor::div[contains(@class, 'items-start')][1]");
    await itemRow
      .getByRole("button", { name: "Set checklist item due date" })
      .click();
    await page
      .locator(`time[datetime="${toDateKey(today)}"]`)
      .filter({ visible: true })
      .click();
    await page.getByRole("checkbox", { name: "Time" }).check();
    const updated = waitForTrpcMutation(page, "checklist.updateItem");
    await itemRow.getByRole("button", { name: "Save" }).click();
    await updated;

    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => /^\/boards\/[^/]+$/.test(url.pathname));
    await page.setViewportSize({ width: 375, height: 812 });
    await calendar.open();

    const itemLink = page
      .getByRole("link", { name: /Contact the guide/ })
      .filter({ visible: true });
    await expect(itemLink).toBeVisible();
    await expect(itemLink.locator("time")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /^Plan the route/ }).filter({
        visible: true,
      }),
    ).toBeVisible();

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    await page
      .locator(`button time[datetime="${toDateKey(tomorrow)}"]`)
      .filter({ visible: true })
      .click();
    await expect(page.getByText("No cards scheduled")).toBeVisible();
    await page
      .locator(`button time[datetime="${toDateKey(today)}"]`)
      .filter({ visible: true })
      .click();
    await expect(itemLink).toBeVisible();

    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(itemLink).toBeVisible();

    await itemLink.click();
    await page.waitForURL((url) => url.pathname.startsWith("/cards/"));
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => url.searchParams.get("view") === "calendar");
    await expect(itemLink).toBeVisible();

    await page.getByRole("button", { name: "Add card" }).click();
    await page.getByPlaceholder("Card title").fill("Mobile follow-up");
    const created = waitForTrpcMutation(page, "card.create");
    await page.getByRole("button", { name: "Create card" }).click();
    await created;
    await expect(
      page.getByRole("link", { name: /^Mobile follow-up/ }).filter({
        visible: true,
      }),
    ).toBeVisible();
  },
);

test(
  "the calendar month and week can be navigated and reset with Today",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const dashboard = new DashboardPage(page);
    const board = new BoardPage(page);
    const calendar = new CalendarPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await dashboard.expectSignedInAs(user);

    await board.createBoard("Calendar Nav Board");
    await board.createList("To do");
    await calendar.open();

    const currentMonthLabel = await calendar.monthLabel();

    await calendar.goToNextMonth();
    await expect.poll(() => calendar.monthLabel()).not.toBe(currentMonthLabel);

    await calendar.goToToday();
    await expect.poll(() => calendar.monthLabel()).toBe(currentMonthLabel);

    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect.poll(() => calendar.monthLabel()).not.toBe(currentMonthLabel);
    const currentWeekLabel = await calendar.monthLabel();
    await page.getByRole("button", { name: "Next week" }).click();
    await expect.poll(() => calendar.monthLabel()).not.toBe(currentWeekLabel);

    await calendar.goToToday();
    await expect.poll(() => calendar.monthLabel()).toBe(currentWeekLabel);

    await calendar.createCardOnDate(new Date(), "Return to this week");
    await page
      .getByRole("link", { name: "Return to this week" })
      .filter({ visible: true })
      .click();
    await page.getByRole("link", { name: "Close" }).click();
    await page.waitForURL((url) => url.searchParams.get("view") === "calendar");
    await expect(
      page.getByRole("button", { name: "Week", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => calendar.monthLabel()).toBe(currentWeekLabel);

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect.poll(() => calendar.monthLabel()).toBe(currentMonthLabel);
  },
);
