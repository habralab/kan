import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import {
  boards,
  cards,
  cardsToLabels,
  labels,
  lists,
  timeTrackingWorklogs,
  workspaceMembers,
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

    expect(updated).toMatchObject({
      durationSeconds: 5400,
      comment: "Corrected entry",
      updatedBy: userId,
    });
    expect(firstDelete.deleted).toBe(true);
    expect(secondDelete.deleted).toBe(false);
    expect(page.items).toEqual([]);
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

  it("credits historical members but rejects invited members", async () => {
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
    if (historicalMembers.length !== 2 || !invitedMember)
      throw new Error("Unable to create historical test members");
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });

    for (const member of historicalMembers) {
      await timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: member.publicId,
        workDate: "2026-09-01",
        durationSeconds: 60,
        comment: null,
        actorUserId: userId,
      });
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
    const page = await timeTrackingRepo.listWorklogsByCard(db, {
      cardPublicId,
      limit: 25,
    });
    const memberOptions = await timeTrackingRepo.getTimeTrackingMemberOptions(
      db,
      workspaceId,
      true,
    );
    expect(
      page.items.map((item) => item.workspaceMember.status).sort(),
    ).toEqual(["paused", "removed"]);
    expect(memberOptions.map((member) => member.status).sort()).toEqual([
      "active",
      "paused",
      "removed",
    ]);
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

    expect(first.unchanged).toBe(false);
    expect(second.unchanged).toBe(true);
    expect(second.timer.publicId).toBe(first.timer.publicId);
    expect(active).toMatchObject({
      publicId: first.timer.publicId,
      cardPublicId,
      comment: "Focus time",
      startedAt,
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
