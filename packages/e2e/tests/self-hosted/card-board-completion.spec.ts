import { expect, test } from "@playwright/test";

import { createDrizzleClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";

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

    let releaseUpdate: (() => void) | undefined;
    const updateCanContinue = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });
    let completionRequestCount = 0;
    await page.route("**/api/trpc/card.update?batch=1", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      completionRequestCount += 1;
      await updateCanContinue;
      await route.continue();
    });

    const completed = waitForTrpcMutation(page, "card.update");
    await markComplete.click();

    await expect(page).toHaveURL(boardUrl);
    const markIncomplete = card.getByRole("button", {
      name: "Mark card as incomplete",
      exact: true,
    });
    await expect(markIncomplete).toBeVisible();
    await expect(markIncomplete).toBeDisabled();
    await expect(markIncomplete).toHaveCSS("cursor", "not-allowed");
    await markIncomplete.evaluate((button: HTMLButtonElement) =>
      button.click(),
    );
    expect(completionRequestCount).toBe(1);
    releaseUpdate?.();
    await completed;
    await page.unroute("**/api/trpc/card.update?batch=1");

    await page.reload();
    await expect(
      page.getByRole("button", {
        name: "Mark card as incomplete",
        exact: true,
      }),
    ).toBeVisible();

    await page.route("**/api/trpc/card.update?batch=1", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "E2E forced completion failure" }),
        });
        return;
      }

      await route.continue();
    });
    const persistedIncomplete = page.getByRole("button", {
      name: "Mark card as incomplete",
      exact: true,
    });
    await persistedIncomplete.click();
    await expect(
      page.getByText("Unable to update card status", { exact: true }),
    ).toBeVisible();
    await expect(persistedIncomplete).toBeVisible();
    await page.unroute("**/api/trpc/card.update?batch=1");

    const cardHref = await cardLink.getAttribute("href");
    const cardPublicId = cardHref?.match(/^\/cards\/([^?]+)/)?.[1];
    if (!cardPublicId) throw new Error("Could not resolve card public ID");

    const db = createDrizzleClient();
    const startDate = new Date(2026, 8, 20, 12);
    await cardRepo.update(db, { startDate, dueDate: null }, { cardPublicId });
    await page.reload();

    const startOnlyCard = page
      .getByRole("link", {
        name: "Open card Complete from board",
        exact: true,
      })
      .locator("..");
    await expect(startOnlyCard.getByText(/(?:Sep 20|20 Sept?)/)).toBeVisible();

    await cardRepo.update(
      db,
      {
        startDate: new Date(2026, 0, 1, 12),
        dueDate: new Date(2026, 11, 31, 18, 30),
        dueDateHasTime: true,
      },
      { cardPublicId },
    );
    await page.setViewportSize({ width: 375, height: 720 });
    await page.reload();

    const narrowCard = page
      .getByRole("link", {
        name: "Open card Complete from board",
        exact: true,
      })
      .locator("..");
    const narrowCardBox = await narrowCard.boundingBox();
    const dateBox = await narrowCard
      .locator('[title*="2026"]')
      .first()
      .boundingBox();
    expect(narrowCardBox).not.toBeNull();
    expect(dateBox).not.toBeNull();
    expect(dateBox?.x ?? 0).toBeGreaterThanOrEqual(narrowCardBox?.x ?? 0);
    expect((dateBox?.x ?? 0) + (dateBox?.width ?? 0)).toBeLessThanOrEqual(
      (narrowCardBox?.x ?? 0) + (narrowCardBox?.width ?? 0) + 1,
    );
  },
);
