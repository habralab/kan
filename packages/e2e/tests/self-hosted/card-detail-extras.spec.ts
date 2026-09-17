import { expect, test } from "@playwright/test";

import { AuthPage } from "../support/pages/auth-page";
import { BoardPage } from "../support/pages/board-page";
import { CardPage } from "../support/pages/card-page";
import { DashboardPage } from "../support/pages/dashboard-page";
import { SelfHostedOnboardingPage } from "../support/pages/self-hosted-onboarding-page";
import { createTestUser } from "../support/test-user";
import { waitForTrpcMutation } from "../support/wait-for-trpc";

test(
  "comments, checklists, member assignment, and due dates can be managed on a card",
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
    const boardPublicId = page.url().split("/boards/")[1];
    if (!boardPublicId) throw new Error("Could not resolve boardPublicId");
    await board.createList("To do");
    await board.createCard("Card detail test card");
    await board.openCard("Card detail test card");

    await card.addComment("First comment");
    await expect(page.getByText("First comment")).toBeVisible();

    await card.editComment("Edited comment");
    await expect(page.getByText("Edited comment")).toBeVisible();
    await expect(page.getByText("(edited)")).toBeVisible();

    await card.deleteComment();
    await expect(page.getByText("Edited comment")).toHaveCount(0);

    await card.createChecklist("My checklist");
    await expect(page.getByText("My checklist")).toBeVisible();

    await card.addChecklistItem("Buy milk");
    await expect(page.getByText("Buy milk")).toBeVisible();

    await card.toggleChecklistItem("Buy milk");
    await page.reload();
    await expect(page.getByText("1/1")).toBeVisible();

    const itemEditor = page.locator(".plain-text-editor").filter({
      hasText: "Buy milk",
    });
    await page.getByRole("button", { name: "Hide completed items" }).click();
    await expect(itemEditor).toHaveCount(0);
    await expect(page.getByText("1/1")).toBeVisible();
    await page.getByRole("button", { name: "Show completed items" }).click();
    await expect(itemEditor).toBeVisible();

    const itemRow = itemEditor.locator(
      "xpath=ancestor::div[contains(@class, 'items-start')][1]",
    );
    await expect(
      page.getByRole("checkbox", { name: "Mark “Buy milk” incomplete" }),
    ).toBeVisible();
    await itemRow
      .getByRole("button", { name: "Checklist item assignee" })
      .click();
    const memberSearch = page.getByRole("searchbox", {
      name: "Search members",
    });
    await memberSearch.fill("no-such-member");
    await expect(page.getByText("No members found.")).toBeVisible();
    await memberSearch.fill(user.email);
    const memberOption = page.getByRole("button").filter({
      hasText: user.email,
    });
    await expect(memberOption).toHaveCount(1);
    const assigned = waitForTrpcMutation(page, "checklist.updateItem");
    await memberOption.click();
    await assigned;
    await expect(itemRow.getByText(user.name)).toBeVisible();

    let checklistDateUpdateCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/api/trpc/checklist.updateItem")
      ) {
        checklistDateUpdateCount += 1;
      }
    });
    const checklistDateButton = itemRow.getByRole("button", {
      name: "Set checklist item due date",
    });
    await checklistDateButton.click();
    const itemDueDate = new Date().toISOString().slice(0, 10);
    await page
      .locator(`time[datetime="${itemDueDate}"]`)
      .filter({ visible: true })
      .click();
    await itemRow.getByRole("button", { name: "Cancel" }).click();
    expect(checklistDateUpdateCount).toBe(0);
    await expect(checklistDateButton).toBeVisible();

    await checklistDateButton.click();
    await page
      .locator(`time[datetime="${itemDueDate}"]`)
      .filter({ visible: true })
      .click();
    const dated = waitForTrpcMutation(page, "checklist.updateItem");
    await itemRow.getByRole("button", { name: "Save" }).click();
    await dated;
    expect(checklistDateUpdateCount).toBe(1);
    await expect(
      itemRow.getByRole("button", { name: "Edit checklist item due date" }),
    ).toBeVisible();

    await card.addChecklistItem("Remove me");
    const removableItem = page.locator(".plain-text-editor").filter({
      hasText: "Remove me",
    });
    const deleteItemButton = page.getByRole("button", {
      name: "Delete checklist item “Remove me”",
    });
    await deleteItemButton.focus();
    await expect(deleteItemButton).toBeFocused();
    const deletedItem = waitForTrpcMutation(page, "checklist.deleteItem");
    await deleteItemButton.press("Enter");
    await deletedItem;
    await expect(removableItem).toHaveCount(0);

    await card.assignMember(user.name);
    let cardDateUpdateCount = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().includes("/api/trpc/card.update")
      ) {
        cardDateUpdateCount += 1;
      }
    });
    await card.setDateRange("2026-09-20", "2026-09-25", "15:30");
    expect(cardDateUpdateCount).toBe(1);

    const cardPublicId = page.url().split("/cards/")[1];
    if (!cardPublicId) throw new Error("Could not resolve cardPublicId");

    const cardResponse = await page.request.get(
      `/api/trpc/card.byId?batch=1&input=${encodeURIComponent(
        JSON.stringify({ "0": { json: { cardPublicId } } }),
      )}`,
    );
    const cardBody = (await cardResponse.json()) as [
      {
        result: {
          data: {
            json: {
              members: {
                email: string;
                user: { name: string | null } | null;
              }[];
              dueDate: string | null;
              startDate: string | null;
              dueDateHasTime: boolean;
            };
          };
        };
      },
    ];
    const cardJson = cardBody[0].result.data.json;
    expect(
      cardJson.members.some(
        (m) => m.user?.name === user.name || m.email === user.email,
      ),
    ).toBe(true);
    expect(cardJson.dueDate).not.toBeNull();
    expect(cardJson.startDate).not.toBeNull();
    expect(cardJson.dueDateHasTime).toBe(true);

    const boardResponse = await page.request.get(
      `/api/trpc/board.byId?batch=1&input=${encodeURIComponent(
        JSON.stringify({
          "0": { json: { boardPublicId, cardView: "summary" } },
        }),
      )}`,
    );
    expect(boardResponse.ok()).toBe(true);
    const boardBody = (await boardResponse.json()) as [
      {
        result: {
          data: {
            json: {
              lists: {
                cards: {
                  publicId: string;
                  description: string | null;
                  attachments: { publicId: string }[];
                  comments: { publicId: string }[];
                  checklists: { publicId: string }[];
                  summary?: {
                    hasDescription: boolean;
                    attachmentCount: number;
                    hasComments: boolean;
                    checklistItemCount: number;
                    completedChecklistItemCount: number;
                  };
                }[];
              }[];
            };
          };
        };
      },
    ];
    const boardCard = boardBody[0].result.data.json.lists
      .flatMap((list) => list.cards)
      .find((item) => item.publicId === cardPublicId);

    expect(boardCard).toMatchObject({
      description: null,
      attachments: [],
      comments: [],
      checklists: [],
      summary: {
        hasDescription: false,
        attachmentCount: 0,
        hasComments: false,
        checklistItemCount: 1,
        completedChecklistItemCount: 1,
      },
    });

    await card.deleteChecklist();
    await expect(
      page.getByRole("textbox", { name: "My checklist" }),
    ).toHaveCount(0);
  },
);
