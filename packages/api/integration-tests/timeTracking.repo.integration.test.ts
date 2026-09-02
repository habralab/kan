import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import {
  boards,
  cards,
  cardsToLabels,
  labels,
  lists,
  timeTrackingWorklogs,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

describe("time tracking repository", () => {
  let db: TestDbClient;
  let userId: string;
  let workspaceId: number;
  let workspaceMemberId: number;
  let memberPublicId: string;
  let boardId: number;
  let listId: number;
  let cardId: number;

  const boardPublicId = "boardtime001";
  const cardPublicId = "cardtime0001";

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    userId = seeded.user.id;
    workspaceId = seeded.workspace.id;

    const member = await db.query.workspaceMembers.findFirst({
      where: (members, { eq }) => eq(members.userId, userId),
    });
    if (!member) throw new Error("Seeded workspace member not found");
    workspaceMemberId = member.id;
    memberPublicId = member.publicId;

    const [board] = await db
      .insert(boards)
      .values({
        publicId: boardPublicId,
        name: "Time tracking board",
        slug: "time-tracking-board",
        workspaceId,
        createdBy: userId,
      })
      .returning();
    if (!board) throw new Error("Unable to create test board");
    boardId = board.id;
    const [list] = await db
      .insert(lists)
      .values({
        publicId: "listtime0001",
        name: "Doing",
        index: 0,
        boardId: board.id,
        createdBy: userId,
      })
      .returning();
    if (!list) throw new Error("Unable to create test list");
    listId = list.id;
    const [card] = await db
      .insert(cards)
      .values({
        publicId: cardPublicId,
        title: "Implement time tracking",
        index: 0,
        listId: list.id,
        createdBy: userId,
      })
      .returning({ id: cards.id });
    if (!card) throw new Error("Unable to create test card");
    cardId = card.id;
  });

  it("returns effective defaults before settings are persisted", async () => {
    const settings = await timeTrackingRepo.getBoardSettings(db, boardPublicId);

    expect(settings).toMatchObject({
      boardPublicId,
      enabled: false,
      roundingIntervalSeconds: 60,
      minimumDurationSeconds: 60,
      activeTimerCount: 0,
      updatedAt: null,
    });
  });

  it("upserts board settings", async () => {
    const created = await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const updated = await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: false,
      actorUserId: userId,
    });

    expect(created?.enabled).toBe(true);
    expect(updated?.enabled).toBe(false);
    expect(updated?.updatedBy).toBe(userId);
    expect(updated?.updatedAt).toBeInstanceOf(Date);
  });

  it("does not enable time tracking on a template", async () => {
    await db.insert(boards).values({
      publicId: "template0001",
      name: "Time tracking template",
      slug: "time-tracking-template",
      type: "template",
      workspaceId,
      createdBy: userId,
    });

    await expect(
      timeTrackingRepo.updateBoardSettings(db, {
        boardPublicId: "template0001",
        enabled: true,
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "BOARD_NOT_REGULAR" });
  });

  it("rejects manual entries while time tracking is disabled", async () => {
    await expect(
      timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: memberPublicId,
        workDate: "2026-09-01",
        durationSeconds: 3600,
        comment: null,
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "BOARD_DISABLED" });
  });

  it("creates, updates and soft-deletes a manual worklog", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const created = await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: memberPublicId,
      workDate: "2026-09-01",
      durationSeconds: 3600,
      comment: "Initial entry",
      actorUserId: userId,
    });
    if (!created) throw new Error("Unable to create test worklog");

    const updated = await timeTrackingRepo.updateWorklog(db, {
      worklogPublicId: created.publicId,
      workspaceId,
      durationSeconds: 5400,
      comment: "Corrected entry",
      actorUserId: userId,
    });
    const firstDelete = await timeTrackingRepo.deleteWorklog(db, {
      worklogPublicId: created.publicId,
      workspaceId,
      actorUserId: userId,
    });
    const secondDelete = await timeTrackingRepo.deleteWorklog(db, {
      worklogPublicId: created.publicId,
      workspaceId,
      actorUserId: userId,
    });
    const page = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 25,
    });
    const moveBlockers =
      await timeTrackingRepo.getBoardTimeTrackingMoveBlockers(db, boardId);

    expect(updated).toMatchObject({
      durationSeconds: 5400,
      comment: "Corrected entry",
      updatedBy: userId,
    });
    expect(firstDelete.deleted).toBe(true);
    expect(secondDelete.deleted).toBe(false);
    expect(page.items).toEqual([]);
    expect(moveBlockers).toEqual({
      hasWorklogs: true,
      hasActiveTimers: false,
    });
  });

  it("paginates by work date and numeric id without skipping ties", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });

    for (const [workDate, durationSeconds] of [
      ["2026-09-01", 60],
      ["2026-09-01", 120],
      ["2026-08-31", 180],
    ] as const) {
      await timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: memberPublicId,
        workDate,
        durationSeconds,
        comment: null,
        actorUserId: userId,
      });
    }

    const firstPage = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 2,
    });
    if (!firstPage.nextCursor)
      throw new Error("Expected the first page to have a cursor");
    const secondPage = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 2,
      cursor: firstPage.nextCursor,
    });

    expect(firstPage.items.map((item) => item.durationSeconds)).toEqual([
      120, 60,
    ]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(secondPage.items.map((item) => item.durationSeconds)).toEqual([180]);
    expect(secondPage.nextCursor).toBeNull();
  });

  it("filters a card worklog page by workspace member without changing its summary", async () => {
    const [otherMember] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "othermem0001",
        email: "other@example.com",
        workspaceId,
        createdBy: userId,
        role: "member",
        status: "active",
      })
      .returning();
    if (!otherMember) throw new Error("Unable to create another test member");

    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: otherMember.publicId,
      workDate: "2026-09-02",
      durationSeconds: 120,
      comment: null,
      actorUserId: userId,
    });
    await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: memberPublicId,
      workDate: "2026-09-01",
      durationSeconds: 60,
      comment: null,
      actorUserId: userId,
    });
    await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: otherMember.publicId,
      workDate: "2026-08-31",
      durationSeconds: 180,
      comment: null,
      actorUserId: userId,
    });

    const [firstPage, summary] = await Promise.all([
      timeTrackingRepo.listWorklogsByCard(db, {
        cardPublicId,
        workspaceMemberPublicId: otherMember.publicId,
        limit: 1,
      }),
      timeTrackingRepo.getCardWorklogSummary(db, cardId),
    ]);
    if (!firstPage.nextCursor)
      throw new Error("Expected the filtered page to have a cursor");
    const secondPage = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      workspaceMemberPublicId: otherMember.publicId,
      cursor: firstPage.nextCursor,
      limit: 1,
    });

    expect(firstPage.items[0]).toMatchObject({
      durationSeconds: 120,
      workspaceMember: { publicId: otherMember.publicId },
    });
    expect(secondPage.items[0]).toMatchObject({
      durationSeconds: 180,
      workspaceMember: { publicId: otherMember.publicId },
    });
    expect(secondPage.nextCursor).toBeNull();
    expect(summary).toMatchObject({ totalSeconds: 360, entryCount: 3 });
    expect(summary.memberTotals).toHaveLength(2);
  });

  it("filters card worklog pages and summaries by an inclusive date range", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });

    for (const [workDate, durationSeconds] of [
      ["2026-08-31", 60],
      ["2026-09-01", 120],
      ["2026-09-30", 180],
      ["2026-10-01", 240],
    ] as const) {
      await timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: memberPublicId,
        workDate,
        durationSeconds,
        comment: null,
        actorUserId: userId,
      });
    }

    const dateRange = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };
    const [page, summary] = await Promise.all([
      timeTrackingRepo.listWorklogsByCard(db, {
        cardPublicId,
        limit: 10,
        ...dateRange,
      }),
      timeTrackingRepo.getCardWorklogSummary(db, cardId, dateRange),
    ]);

    expect(page.items.map((item) => item.durationSeconds)).toEqual([180, 120]);
    expect(page.nextCursor).toBeNull();
    expect(summary).toMatchObject({
      totalSeconds: 300,
      entryCount: 2,
    });
    expect(summary.memberTotals).toHaveLength(1);
    expect(summary.memberTotals[0]).toMatchObject({
      durationSeconds: 300,
      entryCount: 2,
    });
  });

  it("filters and summarizes a paginated board report", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const [label] = await db
      .insert(labels)
      .values({
        publicId: "labeltime001",
        name: "Research",
        boardId,
        createdBy: userId,
      })
      .returning();
    if (!label) throw new Error("Unable to create test label");
    await db.insert(cardsToLabels).values({ cardId, labelId: label.id });

    for (const [workDate, durationSeconds] of [
      ["2026-09-02", 120],
      ["2026-09-01", 60],
      ["2026-08-31", 300],
    ] as const) {
      await timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: memberPublicId,
        workDate,
        durationSeconds,
        comment: null,
        actorUserId: userId,
      });
    }

    const filters = {
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      labelPublicIds: [label.publicId, "missing00001"],
    };
    const firstPage = await timeTrackingRepo.listBoardWorklogs(db, {
      boardId,
      filters,
      limit: 1,
    });
    if (!firstPage.nextCursor) throw new Error("Expected a report cursor");
    const secondPage = await timeTrackingRepo.listBoardWorklogs(db, {
      boardId,
      filters,
      limit: 1,
      cursor: firstPage.nextCursor,
    });
    const [
      summary,
      options,
      cardTotals,
      memberGroups,
      cardGroups,
      listGroups,
      dateGroups,
    ] = await Promise.all([
      timeTrackingRepo.getBoardWorklogSummary(db, boardId, filters),
      timeTrackingRepo.getBoardReportOptions(db, boardId),
      timeTrackingRepo.getBoardCardTotals(db, boardId),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "member"),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "card"),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "list"),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "date"),
    ]);

    expect(firstPage.items[0]).toMatchObject({
      workDate: "2026-09-02",
      durationSeconds: 120,
      card: {
        labels: [
          {
            label: {
              publicId: label.publicId,
              name: label.name,
            },
          },
        ],
      },
    });
    expect(secondPage.items[0]).toMatchObject({
      workDate: "2026-09-01",
      durationSeconds: 60,
    });
    expect(summary).toEqual({
      totalSeconds: 180,
      entryCount: 2,
      memberCount: 1,
      cardCount: 1,
    });
    expect(options).toMatchObject({
      members: [{ publicId: memberPublicId }],
      cards: [{ publicId: cardPublicId }],
      lists: [{ publicId: "listtime0001" }],
      labels: [{ publicId: label.publicId }],
    });
    expect(cardTotals).toEqual([{ cardPublicId, totalSeconds: 480 }]);
    expect(memberGroups).toMatchObject([
      { publicId: memberPublicId, durationSeconds: 180, entryCount: 2 },
    ]);
    expect(cardGroups).toEqual([
      {
        publicId: cardPublicId,
        label: "Implement time tracking",
        member: null,
        durationSeconds: 180,
        entryCount: 2,
      },
    ]);
    expect(listGroups).toEqual([
      {
        publicId: "listtime0001",
        label: "Doing",
        member: null,
        durationSeconds: 180,
        entryCount: 2,
      },
    ]);
    expect(dateGroups).toEqual([
      {
        publicId: "2026-09-02",
        label: "2026-09-02",
        member: null,
        durationSeconds: 120,
        entryCount: 1,
      },
      {
        publicId: "2026-09-01",
        label: "2026-09-01",
        member: null,
        durationSeconds: 60,
        entryCount: 1,
      },
    ]);
  });

  it("queries a production-sized board report without loading every row", async () => {
    const worklogCount = 25_002;
    const batchSize = 1_000;
    for (let offset = 0; offset < worklogCount; offset += batchSize) {
      const size = Math.min(batchSize, worklogCount - offset);
      await db.insert(timeTrackingWorklogs).values(
        Array.from({ length: size }, (_, index) => {
          const sequence = offset + index;
          return {
            publicId: `perf${sequence.toString().padStart(8, "0")}`,
            boardId,
            cardId,
            workspaceMemberId,
            workDate: sequence % 2 === 0 ? "2026-09-01" : "2026-09-02",
            durationSeconds: 60,
            entryMethod: "manual" as const,
            createdBy: userId,
          };
        }),
      );
    }

    const filters = { dateFrom: "2026-09-01", dateTo: "2026-09-30" };
    const startedAt = performance.now();
    const [summary, firstPage, cardTotals] = await Promise.all([
      timeTrackingRepo.getBoardWorklogSummary(db, boardId, filters),
      timeTrackingRepo.listBoardWorklogs(db, {
        boardId,
        filters,
        limit: 50,
      }),
      timeTrackingRepo.getBoardCardTotals(db, boardId),
    ]);
    const elapsedMs = performance.now() - startedAt;

    expect(summary).toEqual({
      totalSeconds: worklogCount * 60,
      entryCount: worklogCount,
      memberCount: 1,
      cardCount: 1,
    });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(cardTotals).toEqual([
      { cardPublicId, totalSeconds: worklogCount * 60 },
    ]);
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it("returns public worklog and authorization projections", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const created = await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: memberPublicId,
      workDate: "2026-09-01",
      durationSeconds: 3600,
      comment: "Projection test",
      actorUserId: userId,
    });
    if (!created) throw new Error("Unable to create test worklog");

    const [cardContext, member, worklogContext, worklog, summary] =
      await Promise.all([
        timeTrackingRepo.getCardTimeTrackingContext(db, cardPublicId),
        timeTrackingRepo.getActiveWorkspaceMemberForUser(
          db,
          workspaceId,
          userId,
        ),
        timeTrackingRepo.getWorklogContext(db, created.publicId),
        timeTrackingRepo.getWorklogByPublicId(db, created.publicId),
        timeTrackingRepo.getCardWorklogSummary(db, cardId),
      ]);

    expect(cardContext).toMatchObject({
      cardPublicId,
      boardPublicId,
      workspaceId,
      settingsEnabled: true,
    });
    expect(member).toMatchObject({ publicId: memberPublicId });
    expect(worklogContext).toMatchObject({
      workspaceId,
      memberUserId: userId,
      deletedAt: null,
    });
    expect(worklog).toMatchObject({
      publicId: created.publicId,
      workspaceMember: {
        publicId: memberPublicId,
        userId,
        workspace: { showEmailsToMembers: true },
      },
      card: {
        publicId: cardPublicId,
        title: "Implement time tracking",
        list: { publicId: "listtime0001", name: "Doing" },
      },
    });
    expect(worklog).not.toHaveProperty("id");
    expect(summary).toMatchObject({
      totalSeconds: 3600,
      memberTotals: [
        {
          durationSeconds: 3600,
          memberPublicId,
          memberUserId: userId,
        },
      ],
    });
  });

  it("preserves historical entries but rejects inactive manual assignees", async () => {
    const historicalMembers = await db
      .insert(workspaceMembers)
      .values([
        {
          publicId: "pausedmem001",
          email: "paused@example.com",
          workspaceId,
          createdBy: userId,
          role: "member" as const,
          status: "paused" as const,
        },
        {
          publicId: "removedmem01",
          email: "removed@example.com",
          workspaceId,
          createdBy: userId,
          role: "member" as const,
          status: "removed" as const,
        },
        {
          publicId: "deletedmem01",
          email: "deleted@example.com",
          userId,
          workspaceId,
          createdBy: userId,
          role: "member" as const,
          status: "active" as const,
          deletedAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ])
      .returning();
    const [invitedMember] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "invitedmem01",
        email: "invited@example.com",
        workspaceId,
        createdBy: userId,
        role: "member",
        status: "invited",
      })
      .returning();
    if (historicalMembers.length !== 3 || !invitedMember)
      throw new Error("Unable to create historical test members");
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });

    for (const member of historicalMembers) {
      await expect(
        timeTrackingRepo.createManualWorklog(db, {
          cardPublicId,
          workspaceMemberPublicId: member.publicId,
          workDate: "2026-09-01",
          durationSeconds: 60,
          comment: null,
          actorUserId: userId,
        }),
      ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
    }
    await expect(
      timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: invitedMember.publicId,
        workDate: "2026-09-01",
        durationSeconds: 60,
        comment: null,
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
    const insertedHistorical = await db
      .insert(timeTrackingWorklogs)
      .values(
        historicalMembers.map((member, index) => ({
          publicId: `histlog0000${index + 1}`,
          boardId,
          cardId,
          workspaceMemberId: member.id,
          workDate: "2026-09-01",
          durationSeconds: 60,
          comment: null,
          entryMethod: "manual" as const,
          createdBy: userId,
        })),
      )
      .returning();
    await db.insert(timeTrackingWorklogs).values({
      publicId: "activehist01",
      boardId,
      cardId,
      workspaceMemberId,
      workDate: "2026-09-01",
      durationSeconds: 60,
      comment: null,
      entryMethod: "manual",
      createdBy: userId,
    });
    const pausedWorklog = insertedHistorical[0];
    if (!pausedWorklog) throw new Error("Unable to seed historical worklog");
    await expect(
      timeTrackingRepo.updateWorklog(db, {
        worklogPublicId: pausedWorklog.publicId,
        workspaceId,
        workspaceMemberPublicId: historicalMembers[0]?.publicId,
        durationSeconds: 120,
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
    await expect(
      timeTrackingRepo.updateWorklog(db, {
        worklogPublicId: pausedWorklog.publicId,
        workspaceId,
        durationSeconds: 120,
        actorUserId: userId,
      }),
    ).resolves.toMatchObject({
      workspaceMemberId: historicalMembers[0]?.id,
      durationSeconds: 120,
    });
    const page = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 25,
    });
    const memberOptions = await timeTrackingRepo.getTimeTrackingMemberOptions(
      db,
      workspaceId,
    );
    const reportOptions = await timeTrackingRepo.getBoardReportOptions(
      db,
      boardId,
    );
    expect(
      page.items.map((item) => item.workspaceMember.status).sort(),
    ).toEqual(["active", "active", "paused", "removed"]);
    expect(memberOptions.map((member) => member.status)).toEqual(["active"]);
    expect(reportOptions.members[0]?.publicId).toBe(memberPublicId);
    expect(
      reportOptions.members.map(
        (member) => member.status === "active" && member.deletedAt === null,
      ),
    ).toEqual([true, false, false, false]);
  });

  it("rechecks time data while holding the board move lock", async () => {
    const [targetWorkspace] = await db
      .insert(workspaces)
      .values({
        publicId: "targetspace1",
        name: "Target workspace",
        slug: "target-workspace",
        createdBy: userId,
      })
      .returning();
    if (!targetWorkspace) throw new Error("Unable to create target workspace");
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const worklog = await timeTrackingRepo.createManualWorklog(db, {
      cardPublicId,
      workspaceMemberPublicId: memberPublicId,
      workDate: "2026-09-01",
      durationSeconds: 60,
      comment: null,
      actorUserId: userId,
    });
    if (!worklog) throw new Error("Unable to create move blocker");
    await timeTrackingRepo.deleteWorklog(db, {
      worklogPublicId: worklog.publicId,
      workspaceId,
      actorUserId: userId,
    });

    const result = await boardRepo.moveToWorkspace(
      db,
      boardId,
      targetWorkspace.id,
      "moved-time-tracking-board",
    );
    const board = await db.query.boards.findFirst({
      where: eq(boards.id, boardId),
    });

    expect(result).toEqual({
      moved: false,
      reason: "time_tracking_data",
    });
    expect(board?.workspaceId).toBe(workspaceId);
  });

  it("starts one global timer and keeps repeated start idempotent", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    const startedAt = new Date("2026-09-01T10:00:00.000Z");
    const first = await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "Europe/Lisbon",
      comment: "Focus time",
      startedAt,
    });
    const second = await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "UTC",
      comment: "Ignored on idempotent start",
      startedAt: new Date("2026-09-01T10:05:00.000Z"),
    });
    const active = await timeTrackingRepo.getActiveTimer(db, userId);
    const moveBlockers =
      await timeTrackingRepo.getBoardTimeTrackingMoveBlockers(db, boardId);

    expect(first.unchanged).toBe(false);
    expect(second.unchanged).toBe(true);
    expect(second.timer.publicId).toBe(first.timer.publicId);
    expect(active).toMatchObject({
      publicId: first.timer.publicId,
      cardPublicId,
      comment: "Focus time",
      startedAt,
    });
    expect(moveBlockers).toEqual({
      hasWorklogs: false,
      hasActiveTimers: true,
    });
  });

  it("stops a timer once and persists its rounded duration", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "Europe/Lisbon",
      comment: null,
      startedAt: new Date("2026-08-31T23:30:00.000Z"),
    });

    const firstStop = await timeTrackingRepo.stopTimer(db, {
      userId,
      timezone: "Europe/Lisbon",
      stoppedAt: new Date("2026-08-31T23:31:31.000Z"),
    });
    const secondStop = await timeTrackingRepo.stopTimer(db, {
      userId,
      timezone: "Europe/Lisbon",
      stoppedAt: new Date("2026-08-31T23:32:00.000Z"),
    });

    expect(firstStop.stopped).toBe(true);
    expect(firstStop.worklog).toMatchObject({
      workDate: "2026-09-01",
      durationSeconds: 120,
      entryMethod: "timer",
      timerTimezone: "Europe/Lisbon",
      rawElapsedSeconds: 91,
    });
    expect(secondStop).toEqual({ stopped: false, worklog: null });
    expect(await timeTrackingRepo.getActiveTimer(db, userId)).toBeNull();
  });

  it("auto-stops the current timer when another card is started", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await db.insert(cards).values({
      publicId: "cardtime0002",
      title: "Review time tracking",
      index: 1,
      listId,
      createdBy: userId,
    });
    await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "UTC",
      comment: "First card",
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
    });

    const switched = await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId: "cardtime0002",
      timezone: "UTC",
      comment: "Second card",
      startedAt: new Date("2026-09-01T10:01:31.000Z"),
    });
    const active = await timeTrackingRepo.getActiveTimer(db, userId);

    expect(switched.autoStoppedWorklog).toMatchObject({
      comment: "First card",
      durationSeconds: 120,
      rawElapsedSeconds: 91,
    });
    expect(active).toMatchObject({
      cardPublicId: "cardtime0002",
      comment: "Second card",
    });
  });

  it("allows recovery stop after the member becomes inactive", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "UTC",
      comment: null,
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    await db
      .update(workspaceMembers)
      .set({ status: "paused" })
      .where(eq(workspaceMembers.userId, userId));

    const result = await timeTrackingRepo.stopTimer(db, {
      userId,
      timezone: "UTC",
      stoppedAt: new Date("2026-09-01T10:00:31.000Z"),
    });

    expect(result.stopped).toBe(true);
    expect(result.worklog?.durationSeconds).toBe(60);
  });

  it("allows recovery stop after the feature is disabled and board archived", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "UTC",
      comment: null,
      startedAt: new Date("2026-09-01T10:00:00.000Z"),
    });
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: false,
      actorUserId: userId,
    });
    await db
      .update(boards)
      .set({ isArchived: true })
      .where(eq(boards.id, boardId));

    const result = await timeTrackingRepo.stopTimer(db, {
      userId,
      timezone: "UTC",
      stoppedAt: new Date("2026-09-01T10:00:31.000Z"),
    });

    expect(result.stopped).toBe(true);
    expect(result.worklog?.durationSeconds).toBe(60);
  });

  it("discards a timer without creating a worklog", async () => {
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });
    await timeTrackingRepo.startTimer(db, {
      userId,
      cardPublicId,
      timezone: "UTC",
      comment: null,
    });

    expect(await timeTrackingRepo.discardTimer(db, userId)).toEqual({
      discarded: true,
    });
    expect(await timeTrackingRepo.discardTimer(db, userId)).toEqual({
      discarded: false,
    });
    const page = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 25,
    });
    expect(page.items).toEqual([]);
  });
});
