import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";

import {
  assertCanEdit,
  assertPermission,
  hasPermission,
} from "../utils/permissions";
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
  getCardWorklogSummary: vi.fn(),
  getBoardCardTotals: vi.fn(),
  getTimeTrackingMemberOptions: vi.fn(),
  getBoardReportOptions: vi.fn(),
  getBoardWorklogSummary: vi.fn(),
  getBoardWorklogGroups: vi.fn(),
  listBoardWorklogs: vi.fn(),
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
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockRepo = vi.mocked(timeTrackingRepo);
const mockAssertCanEdit = vi.mocked(assertCanEdit);
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
    cardId: 11,
    cardPublicId: "card12345678",
    boardPublicId: "board1234567",
    workspaceId: 42,
    isArchived: false,
    settingsEnabled: true,
    showEmailsToMembers: true,
  };
  const worklog = {
    id: 1,
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
      deletedAt: null,
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
  const inaccessibleTimer = {
    id: 1,
    publicId: "timer1234567",
    startedAt: new Date("2026-09-01T10:00:00Z"),
    startTimezone: "Europe/Lisbon",
    comment: "Sensitive card",
    workspaceMemberId: 7,
    memberUserId: user.id,
    memberStatus: "removed" as const,
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertCanEdit.mockResolvedValue(undefined);
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
        .getActiveTimer(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("protects every procedure family from unauthenticated callers", async () => {
    const caller = timeTrackingRouter.createCaller({ db, user: null } as never);
    const results = await Promise.allSettled([
      caller.getSettings({ boardPublicId: cardContext.boardPublicId }),
      caller.listWorklogs({ cardPublicId: cardContext.cardPublicId }),
      caller.getBoardCardTotals({ boardPublicId: cardContext.boardPublicId }),
      caller.getReportSummary({
        boardPublicId: cardContext.boardPublicId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
      }),
      caller.createWorklog({
        cardPublicId: cardContext.cardPublicId,
        workDate: "2026-09-01",
        durationSeconds: 60,
      }),
      caller.updateWorklog({
        worklogPublicId: worklog.publicId,
        durationSeconds: 60,
      }),
      caller.deleteWorklog({ worklogPublicId: worklog.publicId }),
      caller.startTimer({
        cardPublicId: cardContext.cardPublicId,
        timezone: "UTC",
      }),
      caller.stopTimer({ timezone: "UTC" }),
      caller.discardTimer(),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "UNAUTHORIZED" });
    }
  });

  it("rejects invalid dates, durations, comments, timezones and page sizes", async () => {
    const caller = timeTrackingRouter.createCaller(ctx);
    const results = await Promise.allSettled([
      caller.createWorklog({
        cardPublicId: cardContext.cardPublicId,
        workDate: "2026-02-30",
        durationSeconds: 60,
      }),
      caller.createWorklog({
        cardPublicId: cardContext.cardPublicId,
        workDate: "2026-09-01",
        durationSeconds: 0,
      }),
      caller.createWorklog({
        cardPublicId: cardContext.cardPublicId,
        workDate: "2026-09-01",
        durationSeconds: 2_147_483_648,
      }),
      caller.createWorklog({
        cardPublicId: cardContext.cardPublicId,
        workDate: "2026-09-01",
        durationSeconds: 60,
        comment: "x".repeat(10_001),
      }),
      caller.startTimer({
        cardPublicId: cardContext.cardPublicId,
        timezone: "not/a-timezone",
      }),
      caller.stopTimer({ timezone: "not/a-timezone" }),
      caller.listWorklogs({
        cardPublicId: cardContext.cardPublicId,
        limit: 101,
      }),
      caller.getSettings({ boardPublicId: `${cardContext.boardPublicId}x` }),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(mockRepo.createManualWorklog).not.toHaveBeenCalled();
    expect(mockRepo.startTimer).not.toHaveBeenCalled();
    expect(mockRepo.stopTimer).not.toHaveBeenCalled();
    expect(mockRepo.listWorklogsByCard).not.toHaveBeenCalled();
  });

  it("rejects an invalid opaque cursor before querying worklogs", async () => {
    await expect(
      timeTrackingRouter.createCaller(ctx).listWorklogs({
        cardPublicId: cardContext.cardPublicId,
        cursor: "not-a-cursor",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRepo.listWorklogsByCard).not.toHaveBeenCalled();
  });

  it("rejects incomplete and reversed card date ranges", async () => {
    const caller = timeTrackingRouter.createCaller(ctx);
    const results = await Promise.allSettled([
      caller.listWorklogs({
        cardPublicId: cardContext.cardPublicId,
        dateFrom: "2026-09-01",
      }),
      caller.getCardSummary({
        cardPublicId: cardContext.cardPublicId,
        dateFrom: "2026-09-30",
        dateTo: "2026-09-01",
      }),
    ]);

    for (const result of results) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(mockRepo.listWorklogsByCard).not.toHaveBeenCalled();
    expect(mockRepo.getCardWorklogSummary).not.toHaveBeenCalled();
  });

  it("forwards card date and member filters to the worklog page", async () => {
    mockRepo.listWorklogsByCard.mockResolvedValue({
      items: [worklog],
      nextCursor: null,
    });

    await timeTrackingRouter.createCaller(ctx).listWorklogs({
      cardPublicId: cardContext.cardPublicId,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      workspaceMemberPublicId: "member123456",
    });

    expect(mockRepo.listWorklogsByCard).toHaveBeenCalledWith(db, {
      cardPublicId: cardContext.cardPublicId,
      limit: 25,
      cursor: undefined,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      workspaceMemberPublicId: "member123456",
    });
  });

  it("uses the board edit rule for settings", async () => {
    const settings = {
      boardId: 10,
      boardPublicId: "board1234567",
      boardName: "Test board",
      workspaceId: 42,
      isArchived: false,
      type: "regular" as const,
      createdBy: user.id,
      enabled: false,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    };
    mockRepo.getBoardSettings.mockResolvedValue(settings);

    const result = await timeTrackingRouter.createCaller(ctx).getSettings({
      boardPublicId: settings.boardPublicId,
    });

    expect(mockHasPermission).toHaveBeenCalledWith(
      db,
      user.id,
      settings.workspaceId,
      "board:edit",
    );
    expect(result.canUpdate).toBe(true);
    expect(result).not.toHaveProperty("createdBy");
    expect(result).not.toHaveProperty("workspaceId");
  });

  it("checks board edit or creator access when updating settings", async () => {
    const settings = {
      boardId: 10,
      boardPublicId: "board1234567",
      boardName: "Test board",
      workspaceId: 42,
      isArchived: false,
      type: "regular" as const,
      createdBy: user.id,
      enabled: false,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    };
    mockRepo.getBoardSettings
      .mockResolvedValueOnce(settings)
      .mockResolvedValueOnce({ ...settings, enabled: true });
    mockRepo.updateBoardSettings.mockResolvedValue({ enabled: true } as never);

    await timeTrackingRouter.createCaller(ctx).updateSettings({
      boardPublicId: settings.boardPublicId,
      enabled: true,
    });

    expect(mockAssertCanEdit).toHaveBeenCalledWith(
      db,
      user.id,
      settings.workspaceId,
      "board:edit",
      user.id,
    );
  });

  it("rejects normal reads after workspace membership becomes inactive", async () => {
    mockRepo.getActiveWorkspaceMemberForUser.mockResolvedValue(null);

    await expect(
      timeTrackingRouter.createCaller(ctx).listWorklogs({
        cardPublicId: cardContext.cardPublicId,
        limit: 25,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockAssertPermission).not.toHaveBeenCalled();
    expect(mockRepo.listWorklogsByCard).not.toHaveBeenCalled();
  });

  it("returns card and member totals without internal IDs", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockRepo.getCardWorklogSummary.mockResolvedValue({
      totalSeconds: 3600,
      entryCount: 1,
      memberTotals: [
        {
          durationSeconds: 3600,
          entryCount: 1,
          memberPublicId: "member123456",
          memberEmail: "test@example.com",
          memberStatus: "active",
          memberDeletedAt: null,
          memberUserId: user.id,
          memberDisplayName: "Test User",
          userEmail: "test@example.com",
          showEmailsToMembers: true,
        },
      ],
    });

    const result = await timeTrackingRouter.createCaller(ctx).getCardSummary({
      cardPublicId: cardContext.cardPublicId,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    });

    expect(mockRepo.getCardWorklogSummary).toHaveBeenCalledWith(
      db,
      cardContext.cardId,
      { dateFrom: "2026-09-01", dateTo: "2026-09-30" },
    );
    expect(result).toMatchObject({
      totalSeconds: 3600,
      entryCount: 1,
      canCreate: true,
      canStartTimer: true,
      canManage: true,
    });
    expect(result.memberTotals[0]).not.toHaveProperty("memberUserId");
  });

  it("does not offer a timer to managers without create permission", async () => {
    mockHasPermission.mockImplementation(
      (_db, _userId, _workspaceId, permission) =>
        Promise.resolve(permission === "worklog:manage"),
    );
    mockRepo.getCardWorklogSummary.mockResolvedValue({
      totalSeconds: 0,
      entryCount: 0,
      memberTotals: [],
    });

    const result = await timeTrackingRouter.createCaller(ctx).getCardSummary({
      cardPublicId: cardContext.cardPublicId,
    });

    expect(result.canCreate).toBe(true);
    expect(result.canStartTimer).toBe(false);
    expect(result.canManage).toBe(true);
  });

  it("returns board card totals in one authorized query", async () => {
    mockRepo.getBoardSettings.mockResolvedValue({
      boardId: 10,
      boardPublicId: cardContext.boardPublicId,
      boardName: "Test board",
      workspaceId: cardContext.workspaceId,
      isArchived: false,
      type: "regular",
      createdBy: user.id,
      enabled: true,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
    mockRepo.getBoardCardTotals.mockResolvedValue([
      { cardPublicId: cardContext.cardPublicId, totalSeconds: 3600 },
    ]);

    const result = await timeTrackingRouter
      .createCaller(ctx)
      .getBoardCardTotals({
        boardPublicId: cardContext.boardPublicId,
      });

    expect(mockAssertPermission).toHaveBeenCalledWith(
      db,
      user.id,
      cardContext.workspaceId,
      "worklog:view",
    );
    expect(mockRepo.getBoardCardTotals).toHaveBeenCalledWith(db, 10);
    expect(result).toEqual([
      { cardPublicId: cardContext.cardPublicId, totalSeconds: 3600 },
    ]);
  });

  it("does not return board card totals without worklog view access", async () => {
    mockRepo.getBoardSettings.mockResolvedValue({
      boardId: 10,
      boardPublicId: cardContext.boardPublicId,
      boardName: "Test board",
      workspaceId: cardContext.workspaceId,
      isArchived: false,
      type: "regular",
      createdBy: user.id,
      enabled: true,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
    mockAssertPermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN" }));

    await expect(
      timeTrackingRouter.createCaller(ctx).getBoardCardTotals({
        boardPublicId: cardContext.boardPublicId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRepo.getBoardCardTotals).not.toHaveBeenCalled();
  });

  it("only returns the current member without worklog:manage", async () => {
    mockHasPermission.mockImplementation(
      (_db, _userId, _workspaceId, permission) =>
        Promise.resolve(permission === "worklog:create"),
    );
    mockRepo.getTimeTrackingMemberOptions.mockResolvedValue([
      {
        publicId: "member123456",
        email: "test@example.com",
        status: "active",
        deletedAt: null,
        userId: user.id,
        displayName: "Test User",
        userEmail: "test@example.com",
        showEmailsToMembers: true,
      },
      {
        publicId: "another12345",
        email: "another@example.com",
        status: "active",
        deletedAt: null,
        userId: "00000000-0000-0000-0000-000000000002",
        displayName: "Another User",
        userEmail: "another@example.com",
        showEmailsToMembers: true,
      },
    ]);

    const result = await timeTrackingRouter.createCaller(ctx).getMemberOptions({
      cardPublicId: cardContext.cardPublicId,
    });

    expect(mockRepo.getTimeTrackingMemberOptions).toHaveBeenCalledWith(
      db,
      cardContext.workspaceId,
    );
    expect(result).toEqual({
      members: [
        {
          publicId: "member123456",
          displayName: "Test User",
          email: "test@example.com",
          status: "active",
        },
      ],
      canManage: false,
      defaultMemberPublicId: "member123456",
    });
  });

  it("returns the current member as the manager default", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockRepo.getTimeTrackingMemberOptions.mockResolvedValue([
      {
        publicId: "member123456",
        email: "test@example.com",
        status: "active",
        deletedAt: null,
        userId: user.id,
        displayName: "Test User",
        userEmail: "test@example.com",
        showEmailsToMembers: true,
      },
    ]);

    const result = await timeTrackingRouter.createCaller(ctx).getMemberOptions({
      cardPublicId: cardContext.cardPublicId,
    });

    expect(result.members).toEqual([
      {
        publicId: "member123456",
        displayName: "Test User",
        email: "test@example.com",
        status: "active",
      },
    ]);
    expect(result.defaultMemberPublicId).toBe("member123456");
    expect(mockRepo.getTimeTrackingMemberOptions).toHaveBeenCalledWith(
      db,
      cardContext.workspaceId,
    );
  });

  it("returns a filtered board report without internal IDs", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockRepo.getBoardSettings.mockResolvedValue({
      boardId: 10,
      boardPublicId: cardContext.boardPublicId,
      boardName: "Test board",
      workspaceId: cardContext.workspaceId,
      isArchived: false,
      type: "regular",
      createdBy: user.id,
      enabled: true,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
    mockRepo.listBoardWorklogs.mockResolvedValue({
      items: [
        {
          ...worklog,
          id: 1,
          card: {
            ...worklog.card,
            labels: [
              {
                label: {
                  publicId: "label1234567",
                  name: "Migration",
                  deletedAt: null,
                },
              },
            ],
          },
        },
      ],
      nextCursor: { workDate: "2026-09-01", id: 1 },
    });

    const result = await timeTrackingRouter
      .createCaller(ctx)
      .listReportWorklogs({
        boardPublicId: cardContext.boardPublicId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        labelPublicIds: ["label1234567", "label1234567"],
        limit: 50,
      });

    expect(mockRepo.listBoardWorklogs).toHaveBeenCalledWith(db, {
      boardId: 10,
      filters: {
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        labelPublicIds: ["label1234567"],
      },
      limit: 50,
      cursor: undefined,
    });
    expect(result.items[0]?.labels).toEqual([
      { publicId: "label1234567", name: "Migration" },
    ]);
    expect(result.items[0]).not.toHaveProperty("id");
    expect(result.nextCursor).not.toContain("2026-09-01");
  });

  it("keeps imported orphan records visible without inventing identities", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockRepo.getBoardSettings.mockResolvedValue({
      boardId: 10,
      boardPublicId: cardContext.boardPublicId,
      boardName: "Test board",
      workspaceId: cardContext.workspaceId,
      isArchived: false,
      type: "regular",
      createdBy: user.id,
      enabled: true,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
    mockRepo.listBoardWorklogs.mockResolvedValue({
      items: [
        {
          ...worklog,
          id: 2,
          entryMethod: "import",
          workspaceMember: null,
          card: null,
          createdByUser: null,
        },
      ],
      nextCursor: null,
    });

    const result = await timeTrackingRouter
      .createCaller(ctx)
      .listReportWorklogs({
        boardPublicId: cardContext.boardPublicId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
      });

    expect(result.items[0]).toMatchObject({
      entryMethod: "import",
      member: null,
      card: null,
      labels: [],
      createdByDisplayName: null,
      canEdit: false,
    });
  });

  it("rejects an inverted report date range", async () => {
    await expect(
      timeTrackingRouter.createCaller(ctx).getReportSummary({
        boardPublicId: cardContext.boardPublicId,
        dateFrom: "2026-09-30",
        dateTo: "2026-09-01",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRepo.getBoardWorklogSummary).not.toHaveBeenCalled();
  });

  it("bounds report filters to 100 values per dimension", async () => {
    await expect(
      timeTrackingRouter.createCaller(ctx).getReportSummary({
        boardPublicId: cardContext.boardPublicId,
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        cardPublicIds: Array.from({ length: 101 }, () => "card12345678"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockRepo.getBoardWorklogSummary).not.toHaveBeenCalled();
  });

  it("returns one requested grouping without exposing a hidden email", async () => {
    mockHasPermission.mockResolvedValue(true);
    mockRepo.getBoardSettings.mockResolvedValue({
      boardId: 10,
      boardPublicId: cardContext.boardPublicId,
      boardName: "Test board",
      workspaceId: cardContext.workspaceId,
      isArchived: false,
      type: "regular",
      createdBy: user.id,
      enabled: true,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
    mockRepo.getBoardWorklogSummary.mockResolvedValue({
      totalSeconds: 3600,
      entryCount: 1,
      memberCount: 1,
      cardCount: 1,
    });
    mockRepo.getBoardWorklogGroups.mockResolvedValue([
      {
        publicId: "member123456",
        label: null,
        member: {
          publicId: "member123456",
          email: "hidden@example.com",
          status: "active",
          deletedAt: null,
          displayName: null,
          userEmail: "hidden@example.com",
          showEmailsToMembers: false,
          durationSeconds: 3600,
          entryCount: 1,
        },
        durationSeconds: 3600,
        entryCount: 1,
      },
    ]);

    const result = await timeTrackingRouter.createCaller(ctx).getReportSummary({
      boardPublicId: cardContext.boardPublicId,
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      groupBy: "member",
    });

    expect(mockRepo.getBoardWorklogGroups).toHaveBeenCalledWith(
      db,
      10,
      expect.objectContaining({
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
      }),
      "member",
    );
    expect(result.groups).toEqual([
      {
        publicId: "member123456",
        label: "anonymous_member123456",
        durationSeconds: 3600,
        entryCount: 1,
      },
    ]);
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

  it("normalizes an owner's update with worklog:edit", async () => {
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
    mockRepo.updateWorklog.mockResolvedValue(worklog as never);

    await timeTrackingRouter.createCaller(ctx).updateWorklog({
      worklogPublicId: worklog.publicId,
      comment: "   ",
    });

    expect(mockRepo.updateWorklog).toHaveBeenCalledWith(db, {
      worklogPublicId: worklog.publicId,
      workspaceId: 42,
      workspaceMemberPublicId: undefined,
      workDate: undefined,
      durationSeconds: undefined,
      comment: null,
      actorUserId: user.id,
      expectedMemberUserId: user.id,
    });
  });

  it("does not delete another member's entry without worklog:manage", async () => {
    mockRepo.getWorklogContext.mockResolvedValue({
      workspaceId: 42,
      memberUserId: "00000000-0000-0000-0000-000000000002",
      memberStatus: "active",
      memberDeletedAt: null,
      deletedAt: null,
    });
    mockHasPermission.mockImplementation(
      (_db, _userId, _workspaceId, permission) =>
        Promise.resolve(permission === "worklog:delete"),
    );

    await expect(
      timeTrackingRouter.createCaller(ctx).deleteWorklog({
        worklogPublicId: worklog.publicId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRepo.deleteWorklog).not.toHaveBeenCalled();
  });

  it("rechecks ownership when deleting an owner's entry", async () => {
    mockRepo.getWorklogContext.mockResolvedValue({
      workspaceId: 42,
      memberUserId: user.id,
      memberStatus: "active",
      memberDeletedAt: null,
      deletedAt: null,
    });
    mockHasPermission.mockImplementation(
      (_db, _userId, _workspaceId, permission) =>
        Promise.resolve(permission === "worklog:delete"),
    );
    mockRepo.deleteWorklog.mockResolvedValue({
      publicId: worklog.publicId,
      deleted: true,
    });

    await expect(
      timeTrackingRouter.createCaller(ctx).deleteWorklog({
        worklogPublicId: worklog.publicId,
      }),
    ).resolves.toEqual({ publicId: worklog.publicId, deleted: true });
    expect(mockRepo.deleteWorklog).toHaveBeenCalledWith(db, {
      worklogPublicId: worklog.publicId,
      workspaceId: 42,
      actorUserId: user.id,
      expectedMemberUserId: user.id,
    });
  });

  it("does not start a timer without worklog:create", async () => {
    mockAssertPermission
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN" }));

    await expect(
      timeTrackingRouter.createCaller(ctx).startTimer({
        cardPublicId: cardContext.cardPublicId,
        timezone: "UTC",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockRepo.startTimer).not.toHaveBeenCalled();
  });

  it("returns only recovery-safe fields for an inaccessible timer", async () => {
    mockRepo.getActiveTimer.mockResolvedValue(inaccessibleTimer);

    const result = await timeTrackingRouter.createCaller(ctx).getActiveTimer();

    expect(result).toEqual({
      publicId: "timer1234567",
      startedAt: new Date("2026-09-01T10:00:00Z"),
      startTimezone: "Europe/Lisbon",
      inaccessible: true,
    });
    expect(mockHasPermission).not.toHaveBeenCalled();
  });

  it("stops an inaccessible timer without returning protected worklog data", async () => {
    mockRepo.getActiveTimer.mockResolvedValue(inaccessibleTimer);
    mockRepo.stopTimer.mockResolvedValue({
      stopped: true,
      worklog: { publicId: worklog.publicId },
    } as never);

    const result = await timeTrackingRouter.createCaller(ctx).stopTimer({
      timezone: "UTC",
    });

    expect(result).toEqual({ stopped: true, worklog: null });
    expect(mockRepo.getWorklogByPublicId).not.toHaveBeenCalled();
    expect(mockHasPermission).not.toHaveBeenCalled();
  });

  it("allows an inaccessible timer to be discarded without permission checks", async () => {
    mockRepo.discardTimer.mockResolvedValue({ discarded: true });

    await expect(
      timeTrackingRouter.createCaller(ctx).discardTimer(),
    ).resolves.toEqual({ discarded: true });
    expect(mockAssertPermission).not.toHaveBeenCalled();
    expect(mockHasPermission).not.toHaveBeenCalled();
  });
});
