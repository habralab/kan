import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";

vi.mock("@kan/db/repository/cardActivity.repo", () => ({ create: vi.fn() }));
vi.mock("@kan/db/repository/checklist.repo", () => ({
  getChecklistItemByPublicIdWithChecklist: vi.fn(),
  updateItemById: vi.fn(),
}));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getMemberByPublicId: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));

const db = {} as never;
const itemPublicId = "item12345678";
const context = { db, user: { id: "user-1" } } as never;

describe("checklist item due dates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(
      checklistRepo.getChecklistItemByPublicIdWithChecklist,
    ).mockResolvedValue({
      id: 1,
      publicId: itemPublicId,
      title: "Prepare the route",
      completed: false,
      dueDate: null,
      dueDateHasTime: false,
      assigneeId: null,
      checklist: {
        cardId: 2,
        card: { list: { board: { workspace: { id: 3 } } } },
      },
    } as never);
  });

  it("records a new timed due date without changing the item title", async () => {
    const dueDate = new Date("2026-09-15T18:00:00.000Z");
    vi.mocked(checklistRepo.updateItemById).mockResolvedValue({
      publicId: itemPublicId,
      title: "Prepare the route",
      completed: false,
      dueDate,
      dueDateHasTime: true,
    });

    const { checklistRouter } = await import("./checklist");
    const caller = checklistRouter.createCaller(context);
    await caller.updateItem({
      checklistItemPublicId: itemPublicId,
      dueDate,
      dueDateHasTime: true,
    });

    expect(checklistRepo.updateItemById).toHaveBeenCalledWith(db, {
      id: 1,
      title: undefined,
      completed: undefined,
      dueDate,
      dueDateHasTime: true,
      assigneeId: undefined,
    });
    expect(cardActivityRepo.create).toHaveBeenCalledWith(db, {
      type: "card.updated.checklist.item.dueDate.added",
      cardId: 2,
      toTitle: "Prepare the route",
      fromDueDate: undefined,
      toDueDate: dueDate,
      toDueDateHasTime: true,
      createdBy: "user-1",
    });
  });

  it("rejects a time flag without a due date", async () => {
    const { checklistRouter } = await import("./checklist");
    const caller = checklistRouter.createCaller(context);

    await expect(
      caller.updateItem({
        checklistItemPublicId: itemPublicId,
        dueDateHasTime: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(checklistRepo.updateItemById).not.toHaveBeenCalled();
  });

  it("assigns an active workspace member and records the change", async () => {
    vi.mocked(workspaceRepo.getMemberByPublicId).mockResolvedValue({
      id: 9,
      status: "active",
    } as never);
    vi.mocked(checklistRepo.updateItemById).mockResolvedValue({
      publicId: itemPublicId,
      title: "Prepare the route",
      completed: false,
      dueDate: null,
      dueDateHasTime: false,
    });

    const { checklistRouter } = await import("./checklist");
    await checklistRouter.createCaller(context).updateItem({
      checklistItemPublicId: itemPublicId,
      assigneePublicId: "member123456",
    });

    expect(workspaceRepo.getMemberByPublicId).toHaveBeenCalledWith(
      db,
      "member123456",
      3,
    );
    expect(checklistRepo.updateItemById).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ assigneeId: 9 }),
    );
    expect(cardActivityRepo.create).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        type: "card.updated.checklist.item.assignee.assigned",
        workspaceMemberId: 9,
        cardId: 2,
      }),
    );
  });

  it("rejects paused members without changing the item", async () => {
    vi.mocked(workspaceRepo.getMemberByPublicId).mockResolvedValue({
      id: 9,
      status: "paused",
    } as never);
    const { checklistRouter } = await import("./checklist");

    await expect(
      checklistRouter.createCaller(context).updateItem({
        checklistItemPublicId: itemPublicId,
        assigneePublicId: "member123456",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(checklistRepo.updateItemById).not.toHaveBeenCalled();
  });
});
