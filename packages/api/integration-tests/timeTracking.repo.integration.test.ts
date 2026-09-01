import { beforeEach, describe, expect, it } from "vitest";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import { boards, cards, lists, workspaceMembers } from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

describe("time tracking repository", () => {
  let db: TestDbClient;
  let userId: string;
  let workspaceId: number;
  let memberPublicId: string;

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
    await db.insert(cards).values({
      publicId: cardPublicId,
      title: "Implement time tracking",
      index: 0,
      listId: list.id,
      createdBy: userId,
    });
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

  it("does not credit an inactive member", async () => {
    const [foreignMember] = await db
      .insert(workspaceMembers)
      .values({
        publicId: "foreignmem01",
        email: "foreign@example.com",
        workspaceId,
        createdBy: userId,
        role: "member",
        status: "removed",
      })
      .returning();
    if (!foreignMember) throw new Error("Unable to create inactive member");
    await timeTrackingRepo.updateBoardSettings(db, {
      boardPublicId,
      enabled: true,
      actorUserId: userId,
    });

    await expect(
      timeTrackingRepo.createManualWorklog(db, {
        cardPublicId,
        workspaceMemberPublicId: foreignMember.publicId,
        workDate: "2026-09-01",
        durationSeconds: 60,
        comment: null,
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });
  });
});
