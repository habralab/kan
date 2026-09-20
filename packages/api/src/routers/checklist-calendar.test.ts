import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/checklist.repo", () => ({
  getCalendarItemsByBoardPublicId: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

const db = {} as never;
const boardPublicId = "board1234567";
const context = { db, user: { id: "user-1" } } as never;

describe("calendar checklist items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(
      boardRepo.getWorkspaceAndBoardIdByBoardPublicId,
    ).mockResolvedValue({ workspaceId: 3 } as never);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
  });

  it("returns only the lightweight dated items after checking board access", async () => {
    const dueDate = new Date("2026-09-15T18:00:00.000Z");
    vi.mocked(checklistRepo.getCalendarItemsByBoardPublicId).mockResolvedValue([
      {
        publicId: "item12345678",
        title: "Prepare the route",
        completed: false,
        dueDate,
        dueDateHasTime: true,
        cardPublicId: "card12345678",
      },
    ] as never);

    const { checklistRouter } = await import("./checklist");
    const result = await checklistRouter
      .createCaller(context)
      .calendarByBoard({ boardPublicId });

    expect(assertPermission).toHaveBeenCalledWith(
      db,
      "user-1",
      3,
      "board:view",
    );
    expect(checklistRepo.getCalendarItemsByBoardPublicId).toHaveBeenCalledWith(
      db,
      boardPublicId,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.dueDate).toEqual(dueDate);
  });

  it("does not query items without board access", async () => {
    vi.mocked(assertPermission).mockRejectedValue(new Error("Forbidden"));

    const { checklistRouter } = await import("./checklist");
    await expect(
      checklistRouter.createCaller(context).calendarByBoard({ boardPublicId }),
    ).rejects.toThrow("Forbidden");
    expect(
      checklistRepo.getCalendarItemsByBoardPublicId,
    ).not.toHaveBeenCalled();
  });

  it("does not query items for a missing board", async () => {
    vi.mocked(
      boardRepo.getWorkspaceAndBoardIdByBoardPublicId,
    ).mockResolvedValue(undefined);

    const { checklistRouter } = await import("./checklist");
    await expect(
      checklistRouter.createCaller(context).calendarByBoard({ boardPublicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(assertPermission).not.toHaveBeenCalled();
    expect(
      checklistRepo.getCalendarItemsByBoardPublicId,
    ).not.toHaveBeenCalled();
  });
});
