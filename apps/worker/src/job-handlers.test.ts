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
});
