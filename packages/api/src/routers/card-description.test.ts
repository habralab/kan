import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";

import { getJobProducer } from "../utils/job-producer";
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
  completeRecurringOccurrence: vi.fn(),
  reorder: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));
vi.mock("../utils/notifications", () => ({
  sendMentionEmails: vi.fn(),
}));
vi.mock("../utils/job-producer", () => ({ getJobProducer: vi.fn() }));
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
  const card = {
    id: 1,
    publicId: cardPublicId,
    title: "Card",
    description: "<p>Existing description</p>",
    listId: 3,
    dueDate: null,
    startDate: null,
    dueDateHasTime: false,
    dueReminderMinutes: null,
    dueReminderCustom: null,
    dueReminderAt: null,
    completed,
    recurrenceRule: null,
    recurrenceTimezone: null,
    recurrenceAnchorDate: null,
    coverColourCode: null,
    coverAttachment: null,
    coverSize: "normal" as const,
    list: {
      boardId: 4,
      publicId: "list-12345678",
      name: "Todo",
    },
  };
  vi.mocked(cardRepo.getByPublicId).mockResolvedValue(card);
  return card;
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
    dueReminderMinutes: null,
    dueReminderCustom: null,
    dueReminderAt: null,
    completed,
    recurrenceRule: null,
    recurrenceTimezone: null,
    recurrenceAnchorDate: null,
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

  it("stores a timed reminder and its job in the same transaction", async () => {
    const dueDate = new Date(Date.now() + 60 * 60_000);
    const expectedAt = new Date(dueDate.getTime() - 5 * 60_000);
    const existing = mockExistingCard();
    const transaction = { update: vi.fn() };
    const db = {
      transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const enqueue = vi.fn().mockResolvedValue("job-1");
    vi.mocked(getJobProducer).mockResolvedValue({ enqueue } as never);
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue(existing);
    vi.mocked(cardRepo.update).mockResolvedValue({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate,
      startDate: null,
      dueDateHasTime: true,
      dueReminderMinutes: 5,
      dueReminderCustom: null,
      dueReminderAt: expectedAt,
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
    });

    const { cardRouter } = await import("./card");
    await cardRouter
      .createCaller({
        user: { id: "user-123", name: "Test User", email: "test@example.com" },
        db,
      } as never)
      .update({
        cardPublicId,
        dueDate,
        dueDateHasTime: true,
        dueReminderMinutes: 5,
        dueReminderCustom: null,
      });

    expect(cardRepo.update).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        dueReminderMinutes: 5,
        dueReminderCustom: null,
        dueReminderAt: expectedAt,
      }),
      { cardPublicId },
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "card-due-reminder",
        startAfter: expectedAt,
        transaction,
      }),
    );
  });

  it("schedules a custom date-only reminder and clears the minute mode", async () => {
    const dueDate = new Date("2030-06-15T12:00:00Z");
    const config = { daysBefore: 1, time: "09:00", timezone: "Europe/London" };
    const reminderAt = new Date("2030-06-14T08:00:00Z");
    const existing = mockExistingCard();
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
      ...existing,
      dueDate,
      dueDateHasTime: false,
    });
    vi.mocked(cardRepo.update).mockResolvedValue({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate,
      startDate: null,
      dueDateHasTime: false,
      dueReminderMinutes: null,
      dueReminderCustom: config,
      dueReminderAt: reminderAt,
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
    });
    const transaction = {};
    const db = {
      transaction: vi.fn(
        async (callback: (tx: typeof transaction) => Promise<unknown>) =>
          callback(transaction),
      ),
    };
    const enqueue = vi.fn().mockResolvedValue("job-1");
    vi.mocked(getJobProducer).mockResolvedValue({ enqueue } as never);
    const { cardRouter } = await import("./card");
    await cardRouter
      .createCaller({
        user: { id: "user-123", name: "Test", email: "test@example.com" },
        db,
      } as never)
      .update({ cardPublicId, dueReminderCustom: config });
    expect(cardRepo.update).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        dueReminderCustom: config,
        dueReminderMinutes: null,
        dueReminderAt: reminderAt,
      }),
      { cardPublicId },
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ startAfter: reminderAt, transaction }),
    );
  });

  it("resolves a DST gap on save and rejects a resolved time after a timed deadline", async () => {
    const dueDate = new Date("2026-03-08T12:00:00Z");
    const config = {
      daysBefore: 0,
      time: "02:30",
      timezone: "America/New_York",
    };
    const existing = mockExistingCard();
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
      ...existing,
      dueDate,
      dueDateHasTime: true,
    });
    vi.mocked(cardRepo.update).mockResolvedValue({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate,
      startDate: null,
      dueDateHasTime: true,
      dueReminderMinutes: null,
      dueReminderCustom: config,
      dueReminderAt: new Date("2026-03-08T07:00:00Z"),
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
    });
    const { cardRouter } = await import("./card");
    await cardRouter
      .createCaller(ctx)
      .update({ cardPublicId, dueReminderCustom: config });
    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        dueReminderAt: new Date("2026-03-08T07:00:00Z"),
      }),
      { cardPublicId },
    );
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue({
      ...existing,
      dueDate: new Date("2026-03-08T06:45:00Z"),
      dueDateHasTime: true,
    });
    await expect(
      cardRouter
        .createCaller(ctx)
        .update({ cardPublicId, dueReminderCustom: config }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("preserves a skipped custom reminder through unchanged and edited dates", async () => {
    const dueDate = new Date("2026-03-08T06:45:00Z");
    const config = {
      daysBefore: 0,
      time: "02:30",
      timezone: "America/New_York",
    };
    const existing = {
      ...mockExistingCard(),
      dueDate,
      dueDateHasTime: true,
      dueReminderCustom: config,
      dueReminderAt: null,
    };
    vi.mocked(cardRepo.getByPublicId).mockResolvedValue(existing);
    mockUpdatedCard();
    const { cardRouter } = await import("./card");
    const caller = cardRouter.createCaller(ctx);
    await caller.update({
      cardPublicId,
      dueDate,
      dueDateHasTime: true,
      dueReminderCustom: { ...config },
    });
    expect(cardRepo.update).toHaveBeenLastCalledWith(
      mockDb,
      expect.objectContaining({
        dueReminderCustom: config,
        dueReminderAt: null,
        dueReminderMinutes: null,
      }),
      { cardPublicId },
    );
    const nextDate = new Date("2026-03-09T06:45:00Z");
    await caller.update({
      cardPublicId,
      dueDate: nextDate,
      dueDateHasTime: true,
      dueReminderCustom: config,
    });
    expect(cardRepo.update).toHaveBeenLastCalledWith(
      mockDb,
      expect.objectContaining({
        dueReminderCustom: config,
        dueReminderAt: new Date("2026-03-09T06:30:00Z"),
      }),
      { cardPublicId },
    );
    await caller.update({ cardPublicId, title: "Renamed" });
    expect(cardRepo.update).toHaveBeenLastCalledWith(
      mockDb,
      { title: "Renamed" },
      { cardPublicId },
    );
    await expect(
      caller.update({
        cardPublicId,
        dueReminderCustom: { ...config, time: "03:30" },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
      dueReminderMinutes: null,
      dueReminderCustom: null,
      dueReminderAt: null,
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
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

  it("advances a recurring card instead of persisting completion", async () => {
    const dueDate = new Date("2026-09-16T18:00:00.000Z");
    const nextDueDate = new Date("2026-09-23T18:00:00.000Z");
    const existingCard = mockExistingCard();
    vi.mocked(cardRepo.getByPublicId).mockResolvedValueOnce({
      ...existingCard,
      dueDate,
      recurrenceRule: "weekly",
      recurrenceTimezone: "UTC",
      recurrenceAnchorDate: dueDate,
    });
    vi.mocked(cardRepo.completeRecurringOccurrence).mockResolvedValue({
      card: {
        id: 1,
        publicId: cardPublicId,
        title: "Card",
        description: null,
        dueDate: nextDueDate,
        startDate: null,
        completed: false,
        dueDateHasTime: true,
        dueReminderMinutes: null,
        dueReminderCustom: null,
        dueReminderAt: null,
        recurrenceRule: "weekly",
        recurrenceTimezone: "UTC",
        recurrenceAnchorDate: dueDate,
      },
      advanced: true,
      previousDueDate: dueDate,
      previousStartDate: null,
    });

    const { cardRouter } = await import("./card");
    const result = await cardRouter.createCaller(ctx).update({
      cardPublicId,
      completed: true,
    });

    expect(result).toMatchObject({ completed: false, dueDate: nextDueDate });
    expect(cardRepo.update).not.toHaveBeenCalled();
    expect(cardActivityRepo.bulkCreate).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.objectContaining({ completed: false, dueDate: nextDueDate }),
      expect.objectContaining({
        changes: {
          dueDate: { from: dueDate, to: nextDueDate },
        },
      }),
    );
  });

  it("does not emit completion side effects for a stale recurring retry", async () => {
    const dueDate = new Date("2026-09-16T18:00:00.000Z");
    const nextDueDate = new Date("2026-09-23T18:00:00.000Z");
    const existingCard = mockExistingCard();
    vi.mocked(cardRepo.getByPublicId).mockResolvedValueOnce({
      ...existingCard,
      dueDate,
      recurrenceRule: "weekly",
      recurrenceTimezone: "UTC",
      recurrenceAnchorDate: dueDate,
    });
    vi.mocked(cardRepo.completeRecurringOccurrence).mockResolvedValue({
      card: {
        id: 1,
        publicId: cardPublicId,
        title: "Card",
        description: null,
        dueDate: nextDueDate,
        startDate: null,
        completed: false,
        dueDateHasTime: true,
        dueReminderMinutes: null,
        dueReminderCustom: null,
        dueReminderAt: null,
        recurrenceRule: "weekly",
        recurrenceTimezone: "UTC",
        recurrenceAnchorDate: dueDate,
      },
      advanced: false,
    });

    const { cardRouter } = await import("./card");
    const result = await cardRouter.createCaller(ctx).update({
      cardPublicId,
      completed: true,
    });

    expect(result).toMatchObject({ completed: false, dueDate: nextDueDate });
    expect(cardActivityRepo.bulkCreate).not.toHaveBeenCalled();
    expect(createCardWebhookPayload).not.toHaveBeenCalled();
    expect(sendWebhooksForWorkspace).not.toHaveBeenCalled();
  });

  it("anchors a newly configured recurrence to its due date", async () => {
    const dueDate = new Date("2026-09-16T18:00:00.000Z");
    mockExistingCard();
    vi.mocked(cardRepo.update).mockResolvedValueOnce({
      id: 1,
      publicId: cardPublicId,
      title: "Card",
      description: null,
      dueDate,
      startDate: null,
      completed: false,
      dueDateHasTime: true,
      dueReminderMinutes: null,
      dueReminderCustom: null,
      dueReminderAt: null,
      recurrenceRule: "weekly",
      recurrenceTimezone: "UTC",
      recurrenceAnchorDate: dueDate,
    });

    const { cardRouter } = await import("./card");
    await cardRouter.createCaller(ctx).update({
      cardPublicId,
      dueDate,
      dueDateHasTime: true,
      recurrenceRule: "weekly",
      recurrenceTimezone: "UTC",
    });

    expect(cardRepo.update).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        dueDate,
        dueDateHasTime: true,
        dueReminderMinutes: null,
        dueReminderCustom: null,
        dueReminderAt: null,
        recurrenceRule: "weekly",
        recurrenceTimezone: "UTC",
        recurrenceAnchorDate: dueDate,
      }),
      { cardPublicId },
    );
    expect(createCardWebhookPayload).toHaveBeenCalledWith(
      "card.updated",
      expect.objectContaining({
        recurrenceRule: "weekly",
        recurrenceTimezone: "UTC",
        recurrenceAnchorDate: dueDate,
      }),
      expect.objectContaining({
        changes: {
          dueDate: { from: null, to: dueDate },
          dueDateHasTime: { from: false, to: true },
          recurrence: {
            from: { rule: null, timezone: null, anchorDate: null },
            to: {
              rule: "weekly",
              timezone: "UTC",
              anchorDate: dueDate,
            },
          },
        },
      }),
    );
  });

  it("rejects a recurrence timezone without a recurrence rule", async () => {
    const { cardRouter } = await import("./card");

    await expect(
      cardRouter.createCaller(ctx).create({
        title: "Card",
        description: "",
        listPublicId: "list-12345678",
        labelPublicIds: [],
        memberPublicIds: [],
        position: "start",
        customFieldValues: [],
        recurrenceTimezone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
      dueReminderMinutes: null,
      dueReminderCustom: null,
      dueReminderAt: null,
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
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
      dueReminderMinutes: null,
      dueReminderCustom: null,
      dueReminderAt: null,
      completed: false,
      recurrenceRule: null,
      recurrenceTimezone: null,
      recurrenceAnchorDate: null,
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
      {
        dueDate,
        dueDateHasTime: true,
        dueReminderMinutes: null,
        dueReminderCustom: null,
        dueReminderAt: null,
      },
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
