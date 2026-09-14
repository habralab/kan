import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";

import { sendMentionEmails } from "../utils/notifications";
import { assertCanEdit } from "../utils/permissions";
import {
  createCardWebhookPayload,
  sendWebhooksForWorkspace,
} from "../utils/webhook";

vi.mock("@kan/db/repository/card.repo", () => ({
  getWorkspaceAndCardIdByCardPublicId: vi.fn(),
  getByPublicId: vi.fn(),
  update: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(() => ({})),
  sendWebhooksForWorkspace: vi.fn(() => Promise.resolve()),
}));

const mockDb = {} as never;
const cardPublicId = "card-12345678";
const ctx = {
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
  },
  db: mockDb,
} as never;

const mockExistingCard = (completed = false) => {
  vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
    id: 1,
    publicId: cardPublicId,
    title: "Card",
    description: "<p>Existing description</p>",
    listId: 3,
    dueDate: null,
    startDate: null,
    dueDateHasTime: false,
    completed,
    coverColourCode: null,
    coverAttachment: null,
    coverSize: "normal",
    list: {
      boardId: 4,
      publicId: "list-12345678",
      name: "Todo",
    },
  });
};

const mockUpdatedCard = (completed = false) => {
  vi.mocked(cardRepo.update).mockResolvedValue({
    id: 1,
    publicId: cardPublicId,
    title: "Card",
    description: null,
    dueDate: null,
    startDate: null,
    dueDateHasTime: false,
    completed,
  });
};

describe("card updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(assertCanEdit).mockResolvedValue(undefined);
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      id: 1,
      createdBy: "user-123",
      workspaceId: 2,
      workspaceVisibility: "private",
      listPublicId: "list-12345678",
      listName: "Todo",
      boardPublicId: "board-1234567",
      boardName: "Board",
    });
    vi.mocked(cardActivityRepo.bulkCreate).mockResolvedValue([]);
    vi.mocked(sendWebhooksForWorkspace).mockResolvedValue(undefined);
  });

  it("records a start date change without changing the due date", async () => {
    const startDate = new Date("2026-09-13T05:00:00.000Z");
    mockExistingCard();
    mockUpdatedCard();
    vi.mocked(cardRepo.update).mockResolvedValueOnce({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate: null,
      startDate,
      dueDateHasTime: false,
      completed: false,
    });

    const { cardRouter } = await import("./card");
    await cardRouter.createCaller(ctx).update({ cardPublicId, startDate });

    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      { startDate },
      { cardPublicId },
    );
    expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
      expect.objectContaining({
        type: "card.updated.startDate.added",
        toStartDate: startDate,
      }),
    ]);
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.objectContaining({ startDate }),
      expect.objectContaining({
        changes: { startDate: { from: null, to: startDate } },
      }),
    );
  });

  it("stores an empty editor document as null", async () => {
    mockExistingCard();
    mockUpdatedCard();

    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      description: "<p></p>",
    });

    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      { description: null },
      { cardPublicId },
    );
    expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
      expect.objectContaining({
        type: "card.updated.description",
        fromDescription: "<p>Existing description</p>",
        toDescription: undefined,
      }),
    ]);
    expect(sendMentionEmails).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.objectContaining({ description: null }),
      expect.objectContaining({
        changes: {
          description: {
            from: "<p>Existing description</p>",
            to: null,
          },
        },
      }),
    );
  });

  it.each([
    {
      previous: false,
      completed: true,
      activityType: "card.updated.completed",
    },
    {
      previous: true,
      completed: false,
      activityType: "card.updated.uncompleted",
    },
  ] as const)(
    "records $activityType when completion changes",
    async ({ previous, completed, activityType }) => {
      mockExistingCard(previous);
      mockUpdatedCard(completed);

      const { cardRouter } = await import("./card");

      await cardRouter.createCaller(ctx).update({
        cardPublicId,
        completed,
      });

      expect(cardRepo.update).toHaveBeenCalledWith(
        mockDb,
        { completed },
        { cardPublicId },
      );
      expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
        {
          type: activityType,
          cardId: 1,
          createdBy: "user-123",
        },
      ]);
      expect(createCardWebhookPayload).toHaveBeenCalledWith(
        "card.updated",
        expect.objectContaining({ completed }),
        expect.objectContaining({
          changes: {
            completed: { from: previous, to: completed },
          },
        }),
      );
    },
  );

  it("does not create activity when completion is unchanged", async () => {
    mockExistingCard();
    mockUpdatedCard();

    const { cardRouter } = await import("./card");

    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      completed: false,
    });

    expect(cardActivityRepo.bulkCreate).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.anything(),
      expect.objectContaining({ changes: undefined }),
    );
  });

  it("records a due-time change even when the timestamp stays the same", async () => {
    vi.clearAllMocks();
    const mockDb = {} as never;
    const cardPublicId = "card-12345678";
    const dueDate = new Date("2026-09-15T18:00:00.000Z");
    const ctx = {
      user: {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
      },
      db: mockDb,
    } as never;

    vi.mocked(assertCanEdit).mockResolvedValue(undefined);
    vi.mocked(cardRepo.getWorkspaceAndCardIdByCardPublicId).mockResolvedValue({
      id: 1,
      createdBy: "user-123",
      workspaceId: 2,
      workspaceVisibility: "private",
      listPublicId: "list-12345678",
      listName: "Todo",
      boardPublicId: "board-1234567",
      boardName: "Board",
    });
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      listId: 3,
      dueDate,
      startDate: null,
      dueDateHasTime: false,
      completed: false,
      coverColourCode: null,
      coverAttachment: null,
      coverSize: "normal",
      list: {
        publicId: "list-12345678",
        name: "Todo",
        boardId: 4,
      },
    });
    vi.mocked(cardRepo.update).mockResolvedValue({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate,
      startDate: null,
      dueDateHasTime: true,
      completed: false,
    });
    vi.mocked(cardActivityRepo.bulkCreate).mockResolvedValue([]);
    vi.mocked(sendWebhooksForWorkspace).mockResolvedValue(undefined);

    const { cardRouter } = await import("./card");
    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      dueDate,
      dueDateHasTime: true,
    });

    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      { dueDate, dueDateHasTime: true },
      { cardPublicId },
    );
    expect(cardActivityRepo.bulkCreate).toHaveBeenCalledWith(mockDb, [
      expect.objectContaining({
        type: "card.updated.dueDate.updated",
        fromDueDate: dueDate,
        toDueDate: dueDate,
        toDueDateHasTime: true,
      }),
    ]);
  });
});
