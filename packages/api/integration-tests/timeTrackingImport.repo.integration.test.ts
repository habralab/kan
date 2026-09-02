import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";
import * as importRepo from "@kan/db/repository/timeTrackingImport.repo";
import {
  boards,
  cards,
  lists,
  timeTrackingImportQuarantine,
  timeTrackingImportRuns,
  timeTrackingWorklogs,
  timeTrackingWorklogSources,
} from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

describe("time tracking import repository", () => {
  let db: TestDbClient;
  let boardPublicId: string;
  let boardId: number;
  let cardPublicId: string;
  let memberPublicId: string;
  let userId: string;

  const source = (
    externalId: string,
    overrides: Partial<importRepo.TimeTrackingImportedWorklogInput> = {},
  ): importRepo.TimeTrackingImportedWorklogInput => ({
    externalId,
    externalBoardId: "external-board-1",
    externalCardId: "external-card-1",
    externalMemberId: "external-member-1",
    sourceCreatedAt: new Date("2026-08-29T08:46:00Z"),
    sourceUpdatedAt: new Date("2026-08-29T09:00:00Z"),
    billable: false,
    invoiced: null,
    sourceHash: createHash("sha256").update(externalId).digest("hex"),
    boardPublicId,
    cardPublicId,
    workspaceMemberPublicId: memberPublicId,
    workDate: "2026-08-29",
    durationSeconds: 3600,
    comment: "Imported work",
    ...overrides,
  });

  const startRun = (provider = "external-time") =>
    importRepo.startTimeTrackingImportRun(db, {
      provider,
      bundleVersion: "kan-time-import-v1",
      manifestSha256: "a".repeat(64),
      inputRecords: 2,
      inputSeconds: 5400,
    });

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    userId = seeded.user.id;
    const member = await db.query.workspaceMembers.findFirst({
      where: (members, { eq }) => eq(members.userId, seeded.user.id),
    });
    if (!member) throw new Error("Seeded workspace member not found");
    memberPublicId = member.publicId;

    boardPublicId = "importboard1";
    cardPublicId = "importcard01";
    const [board] = await db
      .insert(boards)
      .values({
        publicId: boardPublicId,
        name: "Import board",
        slug: "import-board",
        workspaceId: seeded.workspace.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!board) throw new Error("Unable to create import board");
    boardId = board.id;
    const [list] = await db
      .insert(lists)
      .values({
        publicId: "importlist01",
        name: "Imported",
        index: 0,
        boardId: board.id,
        createdBy: seeded.user.id,
      })
      .returning();
    if (!list) throw new Error("Unable to create import list");
    await db.insert(cards).values({
      publicId: cardPublicId,
      title: "Imported card",
      index: 0,
      listId: list.id,
      createdBy: seeded.user.id,
    });
  });

  it("imports resolved and orphan worklogs with generic provenance", async () => {
    const run = await startRun();
    if (!run) throw new Error("Unable to create import run");

    const results = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [
        source("entry-1"),
        source("entry-2", {
          cardPublicId: null,
          workspaceMemberPublicId: null,
          externalCardId: "missing-card",
          externalMemberId: "missing-member",
          durationSeconds: 1800,
        }),
      ],
    });
    const worklogs = await db
      .select()
      .from(timeTrackingWorklogs)
      .orderBy(timeTrackingWorklogs.durationSeconds);
    const sources = await db.select().from(timeTrackingWorklogSources);
    const filters = { dateFrom: "2026-08-01", dateTo: "2026-08-31" };
    const [summary, memberGroups, cardGroups, listGroups] = await Promise.all([
      timeTrackingRepo.getBoardWorklogSummary(db, boardId, filters),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "member"),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "card"),
      timeTrackingRepo.getBoardWorklogGroups(db, boardId, filters, "list"),
    ]);

    expect(results.map((result) => result.disposition)).toEqual([
      "inserted",
      "inserted",
    ]);
    expect(worklogs).toHaveLength(2);
    expect(worklogs[0]).toMatchObject({
      cardId: null,
      workspaceMemberId: null,
      durationSeconds: 1800,
      entryMethod: "import",
      createdBy: null,
    });
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "external-time",
          externalCardId: "missing-card",
          externalMemberId: "missing-member",
          sourceHash: createHash("sha256").update("entry-2").digest("hex"),
        }),
      ]),
    );
    expect(summary).toEqual({
      totalSeconds: 5400,
      entryCount: 2,
      memberCount: 1,
      cardCount: 1,
    });
    expect(memberGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          publicId: timeTrackingRepo.UNAVAILABLE_TIME_TRACKING_MEMBER_GROUP_ID,
          label: "Unavailable member",
          durationSeconds: 1800,
          entryCount: 1,
        }),
      ]),
    );
    for (const groups of [cardGroups, listGroups])
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publicId: timeTrackingRepo.DELETED_TIME_TRACKING_CARD_GROUP_ID,
            label: "Deleted card",
            durationSeconds: 1800,
            entryCount: 1,
          }),
        ]),
      );
  });

  it("preflights all mappings before an import run is created", async () => {
    const summary = await importRepo.validateTimeTrackingImportMappings(db, [
      source("entry-1"),
      source("entry-2", {
        cardPublicId: null,
        workspaceMemberPublicId: null,
      }),
    ]);

    expect(summary).toEqual({ boards: 1, cards: 1, workspaceMembers: 1 });
    await expect(
      importRepo.validateTimeTrackingImportMappings(db, [
        source("entry-3", { cardPublicId: "missingcard1" }),
      ]),
    ).rejects.toMatchObject({ code: "CARD_NOT_IN_BOARD" });
    expect(await db.select().from(timeTrackingImportRuns)).toHaveLength(0);
    expect(await db.select().from(timeTrackingWorklogs)).toHaveLength(0);
  });

  it("is insert-only by default and requires explicit updates", async () => {
    const firstRun = await startRun();
    if (!firstRun) throw new Error("Unable to create first import run");
    await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: firstRun.publicId,
      provider: firstRun.provider,
      records: [source("entry-1")],
    });
    await importRepo.completeTimeTrackingImportRun(db, {
      importRunPublicId: firstRun.publicId,
      counters: importRepo.createEmptyTimeTrackingImportCounters(1, 3600),
    });

    const secondRun = await startRun();
    if (!secondRun) throw new Error("Unable to create second import run");
    const unchanged = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: secondRun.publicId,
      provider: secondRun.provider,
      records: [source("entry-1")],
    });
    const changedRecord = source("entry-1", {
      sourceHash: "b".repeat(64),
      durationSeconds: 7200,
      comment: "Corrected upstream",
    });
    const conflict = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: secondRun.publicId,
      provider: secondRun.provider,
      records: [changedRecord],
    });
    const updated = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: secondRun.publicId,
      provider: secondRun.provider,
      records: [changedRecord],
      updateExisting: true,
    });
    const [stored] = await db
      .select()
      .from(timeTrackingWorklogs)
      .where(eq(timeTrackingWorklogs.publicId, updated[0]!.worklogPublicId!));

    expect(unchanged[0]?.disposition).toBe("skipped");
    expect(conflict[0]?.disposition).toBe("conflict");
    expect(updated[0]?.disposition).toBe("updated");
    expect(stored).toMatchObject({
      durationSeconds: 7200,
      comment: "Corrected upstream",
    });
    expect(await db.select().from(timeTrackingWorklogs)).toHaveLength(1);
  });

  it("quarantines invalid records idempotently and protects source identity", async () => {
    const run = await startRun();
    if (!run) throw new Error("Unable to create import run");
    const record: importRepo.TimeTrackingQuarantineInput = {
      externalId: "invalid-entry",
      externalBoardId: "external-board-1",
      externalCardId: "external-card-1",
      externalMemberId: "external-member-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      billable: null,
      invoiced: null,
      sourceHash: "c".repeat(64),
      reason: "invalid_work_date",
      durationSeconds: 2520,
      normalizedRecord: { date: "0001-10-16", durationSeconds: 2520 },
    };

    const inserted = await importRepo.quarantineTimeTrackingImportBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [record],
    });
    const skipped = await importRepo.quarantineTimeTrackingImportBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [record],
    });
    const conflict = await importRepo.quarantineTimeTrackingImportBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [{ ...record, sourceHash: "d".repeat(64) }],
    });
    const importConflict = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [source("invalid-entry", { sourceHash: "e".repeat(64) })],
    });
    const resolved = await importRepo.importTimeTrackingWorklogBatch(db, {
      importRunPublicId: run.publicId,
      provider: run.provider,
      records: [source("invalid-entry", { sourceHash: "e".repeat(64) })],
      updateExisting: true,
    });
    const [quarantined] = await db.select().from(timeTrackingImportQuarantine);

    expect(inserted[0]?.disposition).toBe("inserted");
    expect(skipped[0]?.disposition).toBe("skipped");
    expect(conflict[0]?.disposition).toBe("conflict");
    expect(importConflict[0]?.disposition).toBe("conflict");
    expect(resolved[0]?.disposition).toBe("inserted");
    expect(quarantined).toMatchObject({
      overrideReference: resolved[0]?.worklogPublicId,
      resolvedAt: expect.any(Date),
    });
    expect(await db.select().from(timeTrackingImportQuarantine)).toHaveLength(
      1,
    );
  });

  it("allows only one running import per provider", async () => {
    const first = await startRun();
    if (!first) throw new Error("Unable to create first import run");

    await expect(startRun()).rejects.toBeTruthy();
    await importRepo.failTimeTrackingImportRun(db, {
      importRunPublicId: first.publicId,
      counters: importRepo.createEmptyTimeTrackingImportCounters(2, 5400),
      error: "Validation failed",
    });
    const next = await startRun();
    const runs = await db.select().from(timeTrackingImportRuns);

    expect(next?.status).toBe("running");
    expect(runs.map((run) => run.status).sort()).toEqual(["failed", "running"]);
  });

  it("keeps orphan and actor exceptions exclusive to imported records", async () => {
    await expect(
      db.insert(timeTrackingWorklogs).values({
        publicId: "manualorphan",
        boardId,
        cardId: null,
        workspaceMemberId: null,
        workDate: "2026-08-29",
        durationSeconds: 60,
        entryMethod: "manual",
        createdBy: null,
      }),
    ).rejects.toBeTruthy();
    await expect(
      db.insert(timeTrackingWorklogs).values({
        publicId: "importactor",
        boardId,
        cardId: null,
        workspaceMemberId: null,
        workDate: "2026-08-29",
        durationSeconds: 60,
        entryMethod: "import",
        createdBy: userId,
      }),
    ).rejects.toBeTruthy();
  });
});
