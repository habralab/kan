import { beforeEach, describe, expect, it, vi } from "vitest";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";

import { assertPermission, hasPermission } from "../utils/permissions";
import { timeTrackingRouter } from "./timeTracking";

vi.mock("@kan/db/repository/timeTracking.repo", () => ({
  TimeTrackingRepositoryError: class extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
  getBoardSettings: vi.fn(),
  updateBoardSettings: vi.fn(),
  getCardTimeTrackingContext: vi.fn(),
  getActiveWorkspaceMemberForUser: vi.fn(),
  getWorklogContext: vi.fn(),
  getWorklogByPublicId: vi.fn(),
  listWorklogsByCard: vi.fn(),
  createManualWorklog: vi.fn(),
  updateWorklog: vi.fn(),
  deleteWorklog: vi.fn(),
  getActiveTimer: vi.fn(),
  startTimer: vi.fn(),
  stopTimer: vi.fn(),
  discardTimer: vi.fn(),
}));

vi.mock("../utils/permissions", () => ({
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockRepo = vi.mocked(timeTrackingRepo);
const mockAssertPermission = vi.mocked(assertPermission);
const mockHasPermission = vi.mocked(hasPermission);

describe("time tracking router", () => {
  const db = {} as never;
  const user = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Test User",
    email: "test@example.com",
  };
  const ctx = { db, user } as never;
  const cardContext = {
    cardPublicId: "card12345678",
    boardPublicId: "board1234567",
    workspaceId: 42,
    isArchived: false,
    settingsEnabled: true,
    showEmailsToMembers: true,
  };
  const worklog = {
    publicId: "worklog12345",
    workDate: "2026-09-01",
    durationSeconds: 3600,
    comment: "Reviewed migration",
    entryMethod: "manual" as const,
    timerStartedAt: null,
    timerStoppedAt: null,
    timerTimezone: null,
    rawElapsedSeconds: null,
    createdAt: new Date("2026-09-01T10:00:00Z"),
    updatedAt: null,
    deletedAt: null,
    workspaceMember: {
      publicId: "member123456",
      email: "test@example.com",
      status: "active" as const,
      userId: user.id,
      user: { name: "Test User", email: "test@example.com" },
      workspace: { showEmailsToMembers: true },
    },
    card: {
      publicId: "card12345678",
      title: "Migration",
      cardNumber: 10,
      list: { publicId: "list12345678", name: "Doing" },
    },
    createdByUser: { name: "Test User" },
    updatedByUser: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertPermission.mockResolvedValue(undefined);
    mockHasPermission.mockResolvedValue(false);
    mockRepo.getCardTimeTrackingContext.mockResolvedValue(cardContext);
    mockRepo.getActiveWorkspaceMemberForUser.mockResolvedValue({
      id: 7,
      publicId: "member123456",
    });
    mockRepo.getWorklogByPublicId.mockResolvedValue(worklog);
  });

  it("requires authentication", async () => {
    await expect(
      timeTrackingRouter
        .createCaller({ db, user: null } as never)
        .getActiveTimer({}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("creates an entry for the current member with worklog:create", async () => {
    mockRepo.createManualWorklog.mockResolvedValue({
      publicId: worklog.publicId,
    } as never);

    const result = await timeTrackingRouter.createCaller(ctx).createWorklog({
      cardPublicId: cardContext.cardPublicId,
      workDate: "2026-09-01",
      durationSeconds: 3600,
      comment: "  Reviewed migration  ",
    });

    expect(mockAssertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      cardContext.workspaceId,
      "worklog:create",
    );
    expect(mockRepo.createManualWorklog).toHaveBeenCalledWith(db, {
      cardPublicId: cardContext.cardPublicId,
      workspaceMemberPublicId: "member123456",
      workDate: "2026-09-01",
      durationSeconds: 3600,
      comment: "Reviewed migration",
      actorUserId: user.id,
    });
    expect(result).not.toHaveProperty("id");
    expect(result.member).not.toHaveProperty("userId");
  });

  it("requires worklog:manage when creating for another member", async () => {
    mockRepo.createManualWorklog.mockResolvedValue({
      publicId: worklog.publicId,
    } as never);

    await timeTrackingRouter.createCaller(ctx).createWorklog({
      cardPublicId: cardContext.cardPublicId,
      workspaceMemberPublicId: "another12345",
      workDate: "2026-09-01",
      durationSeconds: 60,
    });

    expect(mockAssertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      cardContext.workspaceId,
      "worklog:manage",
    );
  });

  it("does not let an owner reassign an entry without worklog:manage", async () => {
    mockRepo.getWorklogContext.mockResolvedValue({
      workspaceId: 42,
      memberUserId: user.id,
      memberStatus: "active",
      memberDeletedAt: null,
      deletedAt: null,
    });
    mockHasPermission.mockImplementation(
      (_db, _userId, _workspaceId, permission) =>
        Promise.resolve(permission === "worklog:edit"),
    );

    await expect(
      timeTrackingRouter.createCaller(ctx).updateWorklog({
        worklogPublicId: worklog.publicId,
        workspaceMemberPublicId: "another12345",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRepo.updateWorklog).not.toHaveBeenCalled();
  });

  it("returns only recovery-safe fields for an inaccessible timer", async () => {
    mockRepo.getActiveTimer.mockResolvedValue({
      id: 1,
      publicId: "timer1234567",
      startedAt: new Date("2026-09-01T10:00:00Z"),
      startTimezone: "Europe/Lisbon",
      comment: "Sensitive card",
      workspaceMemberId: 7,
      memberUserId: user.id,
      memberStatus: "removed",
      memberDeletedAt: null,
      workspaceId: 42,
      workspaceDeletedAt: null,
      cardPublicId: "card12345678",
      cardTitle: "Sensitive card",
      cardNumber: 10,
      cardDeletedAt: null,
      listDeletedAt: null,
      boardPublicId: "board1234567",
      boardName: "Private board",
      boardDeletedAt: null,
      workspacePublicId: "space1234567",
      workspaceName: "Private workspace",
    });

    const result = await timeTrackingRouter
      .createCaller(ctx)
      .getActiveTimer({});

    expect(result).toEqual({
      publicId: "timer1234567",
      startedAt: new Date("2026-09-01T10:00:00Z"),
      startTimezone: "Europe/Lisbon",
      inaccessible: true,
    });
    expect(mockHasPermission).not.toHaveBeenCalled();
  });

  it("allows an inaccessible timer to be discarded without permission checks", async () => {
    mockRepo.discardTimer.mockResolvedValue({ discarded: true });

    await expect(
      timeTrackingRouter.createCaller(ctx).discardTimer({}),
    ).resolves.toEqual({ discarded: true });
    expect(mockAssertPermission).not.toHaveBeenCalled();
    expect(mockHasPermission).not.toHaveBeenCalled();
  });
});
