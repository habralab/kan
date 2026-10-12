import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

test(
  "members can be searched when creating and editing a card",
  { tag: "@self-hosted" },
  async ({ page }) => {
    const user = createTestUser();
    const auth = new AuthPage(page);
    const onboarding = new SelfHostedOnboardingPage(page);
    const board = new BoardPage(page);

    await auth.signUp(user);
    await onboarding.createFirstWorkspace("E2E Test Workspace");
    await board.createBoard("E2E Test Board");
    await board.createList("To do");

    await page.getByRole("button", { name: "Add card", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder("Card title").fill("Searchable members");
    await dialog.getByRole("button", { name: "Members" }).click();

    const search = dialog.getByRole("searchbox", { name: "Search members" });
    await expect(search).toBeFocused();
    await search.fill("not-a-member");
    await expect(dialog.getByText("No members found")).toBeVisible();
    await search.fill(user.name.toUpperCase());

    const checkbox = dialog.getByRole("checkbox", { name: user.name });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await search.fill("not-a-member");
    await expect(checkbox).toHaveCount(0);
    await search.clear();
    await expect(checkbox).toBeChecked();
    await page.keyboard.press("Escape");

    const created = waitForTrpcMutation(page, "card.create");
    await dialog.getByRole("button", { name: "Create card" }).click();
    await created;
    await board.openCard("Searchable members");

    await page
      .locator('[aria-label="Members"]')
      .filter({ visible: true })
      .click();
    const editSearch = page.getByRole("searchbox", { name: "Search members" });
    await editSearch.fill("not-a-member");
    await expect(page.getByText("No members found")).toBeVisible();
    await editSearch.fill(user.name.toUpperCase());

    const selectedMember = page.getByRole("checkbox", { name: user.name });
    await expect(selectedMember).toBeChecked();
    const removed = waitForTrpcMutation(page, "card.addOrRemoveMember");
    await selectedMember.click();
    await removed;
    await expect(selectedMember).not.toBeChecked();
  },
);
