import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";

import { cardRouter } from "./card";

vi.mock("@kan/db/repository/card.repo", () => {
  class CardMoveBlockedByTimeTrackingError extends Error {
    constructor() {
      super("TIME_TRACKING_DATA");
      this.name = "CardMoveBlockedByTimeTrackingError";
    }
  }

  return {
    CardMoveBlockedByTimeTrackingError,
    getWorkspaceAndCardIdByCardPublicId: vi.fn(),
    getByPublicId: vi.fn(),
    reorder: vi.fn(),
    update: vi.fn(),
  };
});

vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));

vi.mock("@kan/db/repository/cardComment.repo", () => ({}));
vi.mock("@kan/db/repository/checklist.repo", () => ({}));
vi.mock("@kan/db/repository/custom-field.repo", () => ({
  moveCardValuesToBoard: vi.fn(),
  CustomFieldRepositoryError: class CustomFieldRepositoryError extends Error {},
}));
vi.mock("@kan/db/repository/label.repo", () => ({}));

vi.mock("@kan/db/repository/list.repo", () => ({
  getWorkspaceAndListIdByListPublicId: vi.fn(),
}));

vi.mock("@kan/db/repository/timeTracking.repo", () => ({
  getCardTimeTrackingMoveBlockers: vi.fn(),
}));

vi.mock("@kan/db/repository/workspace.repo", () => ({}));

vi.mock("@kan/shared/utils", () => ({
  convertDueDateFiltersToRanges: vi.fn(),
  generateAttachmentUrl: vi.fn(),
  generateAvatarUrl: vi.fn(),
  generateUID: vi.fn(() => "generated-id"),
}));

vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("../utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));

vi.mock("../utils/webhook", () => ({
  createCardWebhookPayload: vi.fn(),
  sendWebhooksForWorkspace: vi.fn(),
}));

const mockGetCardContext =
  cardRepo.getWorkspaceAndCardIdByCardPublicId as ReturnType<typeof vi.fn>;
const mockGetCard = cardRepo.getByPublicId as ReturnType<typeof vi.fn>;
const mockReorder = cardRepo.reorder as ReturnType<typeof vi.fn>;
const mockGetList = listRepo.getWorkspaceAndListIdByListPublicId as ReturnType<
  typeof vi.fn
>;
const mockGetMoveBlockers =
  timeTrackingRepo.getCardTimeTrackingMoveBlockers as ReturnType<typeof vi.fn>;

describe("card.update time tracking move guard", () => {
  const db = {} as never;
  const ctx = {
    db,
    user: { id: "user-123", name: "Test User", email: "test@example.com" },
  } as never;
  const input = {
    cardPublicId: "card12345678",
    listPublicId: "list12345678",
    index: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCardContext.mockResolvedValue({
      id: 1,
      createdBy: "user-123",
      workspaceId: 10,
    });
    mockGetCard.mockResolvedValue({
      id: 1,
      publicId: input.cardPublicId,
      title: "Tracked card",
      description: null,
      dueDate: null,
      listId: 11,
      list: { publicId: "source-list1", name: "Doing", boardId: 100 },
    });
    mockGetList.mockResolvedValue({
      id: 22,
      publicId: input.listPublicId,
      name: "Incoming",
      boardId: 200,
      boardPublicId: "target-board1",
      workspaceId: 10,
    });
    mockGetMoveBlockers.mockResolvedValue({
      hasWorklogs: false,
      hasActiveTimers: false,
    });
  });

  it("rejects a cross-board move before mutating the card", async () => {
    mockGetMoveBlockers.mockResolvedValue({
      hasWorklogs: true,
      hasActiveTimers: false,
    });

    await expect(
      cardRouter.createCaller(ctx).update(input),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Cards with time entries or active timers cannot be moved between boards",
    });
    expect(mockGetMoveBlockers).toHaveBeenCalledWith(db, 1);
    expect(mockReorder).not.toHaveBeenCalled();
    expect(cardRepo.update).not.toHaveBeenCalled();
  });

  it("maps the transactional move guard to an API conflict", async () => {
    mockReorder.mockRejectedValue(
      new cardRepo.CardMoveBlockedByTimeTrackingError(),
    );

    await expect(
      cardRouter.createCaller(ctx).update(input),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Cards with time entries or active timers cannot be moved between boards",
    });
    expect(mockGetMoveBlockers).toHaveBeenCalledWith(db, 1);
    expect(mockReorder).toHaveBeenCalledTimes(1);
    const reorderCall = mockReorder.mock.calls[0] as unknown[] | undefined;
    expect(reorderCall?.slice(0, 2)).toEqual([
      db,
      { cardId: 1, newIndex: 0, newListId: 22 },
    ]);
    const reorderOptions = reorderCall?.[2] as
      | { beforeReorder?: unknown }
      | undefined;
    expect(typeof reorderOptions?.beforeReorder).toBe("function");
  });
});
