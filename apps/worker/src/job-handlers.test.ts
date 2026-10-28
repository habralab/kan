import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimDelivery,
  getDueReminder,
  markDelivered,
  releaseDelivery,
} from "@kan/db/repository/cardReminder.repo";
import { sendEmail } from "@kan/email";

vi.mock("@kan/jobs", () => ({
  requirePostgresUrl: vi.fn(() => "postgresql://test"),
}));
vi.mock("@kan/db/client", () => ({
  createDrizzleClient: vi.fn(() => ({ $client: { end: vi.fn() } })),
}));
vi.mock("@kan/db/repository/cardReminder.repo", () => ({
  getDueReminder: vi.fn(),
  claimDelivery: vi.fn(),
  markDelivered: vi.fn(),
  releaseDelivery: vi.fn(),
}));
vi.mock("@kan/email", () => ({ sendEmail: vi.fn() }));

const expectedAt = new Date(Date.now() - 1000);
const card = {
  id: 1,
  publicId: "abcdefghijkl",
  title: "Review",
  boardName: "Planning",
  workspaceId: 2,
  completed: false,
  dueDate: new Date(Date.now() + 60_000),
  dueDateHasTime: true,
  dueReminderMinutes: 5,
  dueReminderCustom: null,
  dueReminderAt: expectedAt,
  recipients: [{ userId: "user-1", email: "user@example.test" }],
};

describe("card due reminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://kan.example.test");
    vi.mocked(getDueReminder).mockResolvedValue(card);
    vi.mocked(claimDelivery).mockResolvedValue(3);
    vi.mocked(markDelivered).mockResolvedValue(undefined);
    vi.mocked(releaseDelivery).mockResolvedValue(undefined);
    vi.mocked(sendEmail).mockResolvedValue(
      {} as Awaited<ReturnType<typeof sendEmail>>,
    );
  });

  it("ignores a stale job after the card deadline changes", async () => {
    vi.mocked(getDueReminder).mockResolvedValue({
      ...card,
      dueReminderAt: new Date(expectedAt.getTime() + 60_000),
    });
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["deleted", null],
    ["completed", { ...card, completed: true }],
    ["reminder removed", { ...card, dueReminderAt: null }],
  ])("ignores a %s card", async (_state, currentCard) => {
    vi.mocked(getDueReminder).mockResolvedValue(currentCard);
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("stops delivery if the occurrence changes between recipient checks", async () => {
    vi.mocked(getDueReminder)
      .mockResolvedValueOnce(card)
      .mockResolvedValueOnce({
        ...card,
        dueReminderAt: new Date(expectedAt.getTime() + 7 * 86400_000),
      });
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends only to current recipients and records the delivery", async () => {
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(sendEmail).toHaveBeenCalledWith(
      "user@example.test",
      expect.any(String),
      "DUE_REMINDER",
      expect.objectContaining({
        cardUrl: "https://kan.example.test/cards/abcdefghijkl",
      }),
    );
    expect(markDelivered).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it("sends a custom date-only reminder with the card's due date", async () => {
    vi.mocked(getDueReminder).mockResolvedValue({
      ...card,
      dueDateHasTime: false,
      dueReminderMinutes: null,
      dueReminderCustom: {
        daysBefore: 0,
        time: "09:00",
        timezone: "Europe/Lisbon",
      },
    });
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(vi.mocked(sendEmail).mock.calls[0]?.[3].dueAtText).not.toContain(
      "UTC",
    );
  });

  it("includes the due time with an explicit UTC timezone", async () => {
    const reminderAt = new Date("2026-10-28T15:40:00.000Z");
    vi.mocked(getDueReminder).mockResolvedValue({
      ...card,
      dueReminderAt: reminderAt,
      dueDate: new Date("2026-10-28T15:45:00.000Z"),
    });
    const now = vi.spyOn(Date, "now").mockReturnValue(reminderAt.getTime());
    try {
      const { cardDueReminder } = await import("./job-handlers");
      await cardDueReminder(
        { cardPublicId: card.publicId, expectedAt: reminderAt.toISOString() },
        "job-1",
      );
      expect(sendEmail).toHaveBeenCalledWith(
        "user@example.test",
        expect.any(String),
        "DUE_REMINDER",
        expect.objectContaining({ dueAtText: "28 Oct 2026, 15:45 UTC" }),
      );
    } finally {
      now.mockRestore();
    }
  });

  it("does not send a duplicate after a recipient was already claimed", async () => {
    vi.mocked(claimDelivery).mockResolvedValue(undefined);
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("skips a member removed before delivery", async () => {
    vi.mocked(getDueReminder)
      .mockResolvedValueOnce(card)
      .mockResolvedValueOnce({ ...card, recipients: [] });
    const { cardDueReminder } = await import("./job-handlers");
    await cardDueReminder(
      { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
      "job-1",
    );
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("releases a failed recipient for retry", async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error("SMTP unavailable"));
    const { cardDueReminder } = await import("./job-handlers");
    await expect(
      cardDueReminder(
        { cardPublicId: card.publicId, expectedAt: expectedAt.toISOString() },
        "job-1",
      ),
    ).rejects.toThrow("could not be delivered");
    expect(releaseDelivery).toHaveBeenCalledWith(expect.anything(), 3);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it("delivers on retry after releasing a failed claim", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP unavailable"));
    const { cardDueReminder } = await import("./job-handlers");
    const job = {
      cardPublicId: card.publicId,
      expectedAt: expectedAt.toISOString(),
    };
    await expect(cardDueReminder(job, "job-1")).rejects.toThrow();
    await cardDueReminder(job, "job-1");
    expect(claimDelivery).toHaveBeenCalledTimes(2);
    expect(releaseDelivery).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith(expect.anything(), 3);
  });
});
