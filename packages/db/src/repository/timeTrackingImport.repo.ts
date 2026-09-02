import { and, eq, inArray, isNull } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import type { TimeTrackingImportCounters } from "@kan/db/schema";
import {
  boards,
  cards,
  lists,
  timeTrackingImportQuarantine,
  timeTrackingImportRuns,
  timeTrackingWorklogs,
  timeTrackingWorklogSources,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const timeTrackingImportRepositoryErrorCodes = [
  "BATCH_TOO_LARGE",
  "DUPLICATE_EXTERNAL_ID",
  "IMPORT_RUN_NOT_FOUND",
  "IMPORT_RUN_NOT_RUNNING",
  "PROVIDER_MISMATCH",
  "BOARD_NOT_FOUND",
  "CARD_NOT_IN_BOARD",
  "MEMBER_NOT_IN_WORKSPACE",
] as const;

export type TimeTrackingImportRepositoryErrorCode =
  (typeof timeTrackingImportRepositoryErrorCodes)[number];

export class TimeTrackingImportRepositoryError extends Error {
  constructor(public readonly code: TimeTrackingImportRepositoryErrorCode) {
    super(code);
    this.name = "TimeTrackingImportRepositoryError";
  }
}

export const createEmptyTimeTrackingImportCounters = (
  inputRecords = 0,
  inputSeconds = 0,
): TimeTrackingImportCounters => ({
  inputRecords,
  inputSeconds,
  insertedRecords: 0,
  insertedSeconds: 0,
  updatedRecords: 0,
  skippedRecords: 0,
  quarantinedRecords: 0,
  quarantinedSeconds: 0,
  conflictRecords: 0,
});

export interface TimeTrackingImportSourceInput {
  externalId: string;
  externalBoardId: string;
  externalCardId: string | null;
  externalMemberId: string | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  billable: boolean | null;
  invoiced: boolean | null;
  sourceHash: string;
}

export interface TimeTrackingImportedWorklogInput
  extends TimeTrackingImportSourceInput {
  boardPublicId: string;
  cardPublicId: string | null;
  workspaceMemberPublicId: string | null;
  workDate: string;
  durationSeconds: number;
  comment: string | null;
}

export interface TimeTrackingQuarantineInput
  extends TimeTrackingImportSourceInput {
  reason: string;
  durationSeconds: number | null;
  normalizedRecord: Record<string, unknown>;
  overrideReference?: string | null;
}

export type TimeTrackingImportDisposition =
  | "inserted"
  | "updated"
  | "skipped"
  | "conflict";

export interface TimeTrackingImportResult {
  externalId: string;
  disposition: TimeTrackingImportDisposition;
  worklogPublicId?: string;
}

const assertBatch = (records: TimeTrackingImportSourceInput[]) => {
  if (records.length > 500)
    throw new TimeTrackingImportRepositoryError("BATCH_TOO_LARGE");

  const externalIds = new Set<string>();
  for (const record of records) {
    if (externalIds.has(record.externalId))
      throw new TimeTrackingImportRepositoryError("DUPLICATE_EXTERNAL_ID");
    externalIds.add(record.externalId);
  }
};

const lockImportRun = async (
  tx: Parameters<Parameters<dbClient["transaction"]>[0]>[0],
  input: { importRunPublicId: string; provider: string },
) => {
  const [run] = await tx
    .select({
      id: timeTrackingImportRuns.id,
      provider: timeTrackingImportRuns.provider,
      status: timeTrackingImportRuns.status,
    })
    .from(timeTrackingImportRuns)
    .where(eq(timeTrackingImportRuns.publicId, input.importRunPublicId))
    .limit(1)
    .for("update");

  if (!run) throw new TimeTrackingImportRepositoryError("IMPORT_RUN_NOT_FOUND");
  if (run.provider !== input.provider)
    throw new TimeTrackingImportRepositoryError("PROVIDER_MISMATCH");
  if (run.status !== "running")
    throw new TimeTrackingImportRepositoryError("IMPORT_RUN_NOT_RUNNING");

  return run;
};

export const startTimeTrackingImportRun = (
  db: dbClient,
  input: {
    provider: string;
    bundleVersion: string;
    manifestSha256: string;
    inputRecords: number;
    inputSeconds: number;
  },
) =>
  db
    .insert(timeTrackingImportRuns)
    .values({
      publicId: generateUID(),
      provider: input.provider,
      bundleVersion: input.bundleVersion,
      manifestSha256: input.manifestSha256,
      counters: createEmptyTimeTrackingImportCounters(
        input.inputRecords,
        input.inputSeconds,
      ),
    })
    .returning()
    .then((rows) => rows[0] ?? null);

export const completeTimeTrackingImportRun = async (
  db: dbClient,
  input: { importRunPublicId: string; counters: TimeTrackingImportCounters },
) => {
  const [run] = await db
    .update(timeTrackingImportRuns)
    .set({
      status: "completed",
      counters: input.counters,
      error: null,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(timeTrackingImportRuns.publicId, input.importRunPublicId),
        eq(timeTrackingImportRuns.status, "running"),
      ),
    )
    .returning();

  if (!run)
    throw new TimeTrackingImportRepositoryError("IMPORT_RUN_NOT_RUNNING");
  return run;
};

export const failTimeTrackingImportRun = async (
  db: dbClient,
  input: {
    importRunPublicId: string;
    counters: TimeTrackingImportCounters;
    error: string;
  },
) => {
  const [run] = await db
    .update(timeTrackingImportRuns)
    .set({
      status: "failed",
      counters: input.counters,
      error: input.error,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(timeTrackingImportRuns.publicId, input.importRunPublicId),
        eq(timeTrackingImportRuns.status, "running"),
      ),
    )
    .returning();

  if (!run)
    throw new TimeTrackingImportRepositoryError("IMPORT_RUN_NOT_RUNNING");
  return run;
};

export const importTimeTrackingWorklogBatch = (
  db: dbClient,
  input: {
    importRunPublicId: string;
    provider: string;
    records: TimeTrackingImportedWorklogInput[];
    updateExisting?: boolean;
  },
) => {
  assertBatch(input.records);
  if (input.records.length === 0) return Promise.resolve([]);

  return db.transaction(async (tx) => {
    const run = await lockImportRun(tx, input);
    const externalIds = input.records.map((record) => record.externalId);
    const [existingSources, quarantinedRecords] = await Promise.all([
      tx
        .select({
          externalId: timeTrackingWorklogSources.externalId,
          sourceHash: timeTrackingWorklogSources.sourceHash,
          sourceId: timeTrackingWorklogSources.id,
          worklogId: timeTrackingWorklogs.id,
          worklogPublicId: timeTrackingWorklogs.publicId,
        })
        .from(timeTrackingWorklogSources)
        .innerJoin(
          timeTrackingWorklogs,
          eq(timeTrackingWorklogSources.worklogId, timeTrackingWorklogs.id),
        )
        .where(
          and(
            eq(timeTrackingWorklogSources.provider, input.provider),
            inArray(timeTrackingWorklogSources.externalId, externalIds),
          ),
        ),
      tx
        .select({
          id: timeTrackingImportQuarantine.id,
          externalId: timeTrackingImportQuarantine.externalId,
        })
        .from(timeTrackingImportQuarantine)
        .where(
          and(
            eq(timeTrackingImportQuarantine.provider, input.provider),
            inArray(timeTrackingImportQuarantine.externalId, externalIds),
            isNull(timeTrackingImportQuarantine.resolvedAt),
          ),
        ),
    ]);
    const existingByExternalId = new Map(
      existingSources.map((source) => [source.externalId, source]),
    );
    const quarantineByExternalId = new Map(
      quarantinedRecords.map((record) => [record.externalId, record]),
    );

    const candidates = input.records.filter((record) => {
      const existing = existingByExternalId.get(record.externalId);
      const quarantined = quarantineByExternalId.has(record.externalId);
      return (
        (!existing && (!quarantined || input.updateExisting === true)) ||
        (input.updateExisting === true &&
          existing?.sourceHash !== record.sourceHash)
      );
    });

    const boardPublicIds = [
      ...new Set(candidates.map((record) => record.boardPublicId)),
    ];
    const cardPublicIds = [
      ...new Set(
        candidates.flatMap((record) =>
          record.cardPublicId ? [record.cardPublicId] : [],
        ),
      ),
    ];
    const memberPublicIds = [
      ...new Set(
        candidates.flatMap((record) =>
          record.workspaceMemberPublicId
            ? [record.workspaceMemberPublicId]
            : [],
        ),
      ),
    ];

    const [boardRows, cardRows, memberRows] = await Promise.all([
      boardPublicIds.length
        ? tx
            .select({
              id: boards.id,
              publicId: boards.publicId,
              workspaceId: boards.workspaceId,
            })
            .from(boards)
            .where(
              and(
                inArray(boards.publicId, boardPublicIds),
                isNull(boards.deletedAt),
              ),
            )
        : [],
      cardPublicIds.length
        ? tx
            .select({
              id: cards.id,
              publicId: cards.publicId,
              boardId: lists.boardId,
            })
            .from(cards)
            .innerJoin(lists, eq(cards.listId, lists.id))
            .where(inArray(cards.publicId, cardPublicIds))
        : [],
      memberPublicIds.length
        ? tx
            .select({
              id: workspaceMembers.id,
              publicId: workspaceMembers.publicId,
              workspaceId: workspaceMembers.workspaceId,
            })
            .from(workspaceMembers)
            .where(inArray(workspaceMembers.publicId, memberPublicIds))
        : [],
    ]);
    const boardsByPublicId = new Map(
      boardRows.map((row) => [row.publicId, row]),
    );
    const cardsByPublicId = new Map(cardRows.map((row) => [row.publicId, row]));
    const membersByPublicId = new Map(
      memberRows.map((row) => [row.publicId, row]),
    );

    const resolvedCandidates = candidates.map((record) => {
      const board = boardsByPublicId.get(record.boardPublicId);
      if (!board)
        throw new TimeTrackingImportRepositoryError("BOARD_NOT_FOUND");

      const card = record.cardPublicId
        ? cardsByPublicId.get(record.cardPublicId)
        : null;
      if (record.cardPublicId && (!card || card.boardId !== board.id))
        throw new TimeTrackingImportRepositoryError("CARD_NOT_IN_BOARD");

      const member = record.workspaceMemberPublicId
        ? membersByPublicId.get(record.workspaceMemberPublicId)
        : null;
      if (
        record.workspaceMemberPublicId &&
        (!member || member.workspaceId !== board.workspaceId)
      )
        throw new TimeTrackingImportRepositoryError("MEMBER_NOT_IN_WORKSPACE");

      return { record, board, card, member };
    });

    const resultsByExternalId = new Map<string, TimeTrackingImportResult>();
    const newCandidates = resolvedCandidates.filter(
      ({ record }) => !existingByExternalId.has(record.externalId),
    );

    if (newCandidates.length) {
      const newWorklogs = newCandidates.map(
        ({ record, board, card, member }) => ({
          publicId: generateUID(),
          boardId: board.id,
          cardId: card?.id ?? null,
          workspaceMemberId: member?.id ?? null,
          workDate: record.workDate,
          durationSeconds: record.durationSeconds,
          comment: record.comment,
          entryMethod: "import" as const,
          createdBy: null,
        }),
      );
      const insertedWorklogs = await tx
        .insert(timeTrackingWorklogs)
        .values(newWorklogs)
        .returning({
          id: timeTrackingWorklogs.id,
          publicId: timeTrackingWorklogs.publicId,
        });
      const worklogsByPublicId = new Map(
        insertedWorklogs.map((worklog) => [worklog.publicId, worklog]),
      );
      const insertedByExternalId = new Map<
        string,
        { id: number; publicId: string }
      >();

      await tx.insert(timeTrackingWorklogSources).values(
        newCandidates.map(({ record }, index) => {
          const newWorklog = newWorklogs[index];
          const worklog = newWorklog
            ? worklogsByPublicId.get(newWorklog.publicId)
            : undefined;
          if (!worklog) throw new Error("Inserted worklog result is missing");
          insertedByExternalId.set(record.externalId, worklog);
          return {
            worklogId: worklog.id,
            importRunId: run.id,
            provider: input.provider,
            externalId: record.externalId,
            externalBoardId: record.externalBoardId,
            externalCardId: record.externalCardId,
            externalMemberId: record.externalMemberId,
            sourceCreatedAt: record.sourceCreatedAt,
            sourceUpdatedAt: record.sourceUpdatedAt,
            billable: record.billable,
            invoiced: record.invoiced,
            sourceHash: record.sourceHash,
          };
        }),
      );

      for (const { record } of newCandidates) {
        const worklog = insertedByExternalId.get(record.externalId);
        if (!worklog) throw new Error("Inserted worklog result is missing");
        const quarantine = quarantineByExternalId.get(record.externalId);
        if (quarantine)
          await tx
            .update(timeTrackingImportQuarantine)
            .set({
              overrideReference: worklog.publicId,
              resolvedAt: new Date(),
            })
            .where(eq(timeTrackingImportQuarantine.id, quarantine.id));
        resultsByExternalId.set(record.externalId, {
          externalId: record.externalId,
          disposition: "inserted",
          worklogPublicId: worklog.publicId,
        });
      }
    }

    for (const { record, board, card, member } of resolvedCandidates) {
      const existing = existingByExternalId.get(record.externalId);
      if (!existing || existing.sourceHash === record.sourceHash) continue;

      await tx
        .update(timeTrackingWorklogs)
        .set({
          boardId: board.id,
          cardId: card?.id ?? null,
          workspaceMemberId: member?.id ?? null,
          workDate: record.workDate,
          durationSeconds: record.durationSeconds,
          comment: record.comment,
          updatedAt: new Date(),
          updatedBy: null,
        })
        .where(eq(timeTrackingWorklogs.id, existing.worklogId));
      await tx
        .update(timeTrackingWorklogSources)
        .set({
          importRunId: run.id,
          externalBoardId: record.externalBoardId,
          externalCardId: record.externalCardId,
          externalMemberId: record.externalMemberId,
          sourceCreatedAt: record.sourceCreatedAt,
          sourceUpdatedAt: record.sourceUpdatedAt,
          billable: record.billable,
          invoiced: record.invoiced,
          sourceHash: record.sourceHash,
        })
        .where(eq(timeTrackingWorklogSources.id, existing.sourceId));
      resultsByExternalId.set(record.externalId, {
        externalId: record.externalId,
        disposition: "updated",
        worklogPublicId: existing.worklogPublicId,
      });
    }

    for (const record of input.records) {
      if (resultsByExternalId.has(record.externalId)) continue;
      const existing = existingByExternalId.get(record.externalId);
      resultsByExternalId.set(record.externalId, {
        externalId: record.externalId,
        disposition:
          existing?.sourceHash === record.sourceHash ? "skipped" : "conflict",
        worklogPublicId: existing?.worklogPublicId,
      });
    }

    return input.records.map((record) => {
      const result = resultsByExternalId.get(record.externalId);
      if (!result) throw new Error("Import result is missing");
      return result;
    });
  });
};

export const quarantineTimeTrackingImportBatch = (
  db: dbClient,
  input: {
    importRunPublicId: string;
    provider: string;
    records: TimeTrackingQuarantineInput[];
    updateExisting?: boolean;
  },
) => {
  assertBatch(input.records);
  if (input.records.length === 0) return Promise.resolve([]);

  return db.transaction(async (tx) => {
    const run = await lockImportRun(tx, input);
    const externalIds = input.records.map((record) => record.externalId);
    const [existingQuarantine, importedSources] = await Promise.all([
      tx
        .select()
        .from(timeTrackingImportQuarantine)
        .where(
          and(
            eq(timeTrackingImportQuarantine.provider, input.provider),
            inArray(timeTrackingImportQuarantine.externalId, externalIds),
          ),
        ),
      tx
        .select({ externalId: timeTrackingWorklogSources.externalId })
        .from(timeTrackingWorklogSources)
        .where(
          and(
            eq(timeTrackingWorklogSources.provider, input.provider),
            inArray(timeTrackingWorklogSources.externalId, externalIds),
          ),
        ),
    ]);
    const existingByExternalId = new Map(
      existingQuarantine.map((record) => [record.externalId, record]),
    );
    const importedExternalIds = new Set(
      importedSources.map((record) => record.externalId),
    );
    const results: TimeTrackingImportResult[] = [];

    for (const record of input.records) {
      if (importedExternalIds.has(record.externalId)) {
        results.push({
          externalId: record.externalId,
          disposition: "conflict",
        });
        continue;
      }

      const existing = existingByExternalId.get(record.externalId);
      if (!existing) {
        await tx.insert(timeTrackingImportQuarantine).values({
          publicId: generateUID(),
          importRunId: run.id,
          provider: input.provider,
          externalId: record.externalId,
          externalBoardId: record.externalBoardId,
          externalCardId: record.externalCardId,
          externalMemberId: record.externalMemberId,
          reason: record.reason,
          durationSeconds: record.durationSeconds,
          normalizedRecord: record.normalizedRecord,
          sourceHash: record.sourceHash,
          overrideReference: record.overrideReference ?? null,
        });
        results.push({
          externalId: record.externalId,
          disposition: "inserted",
        });
        continue;
      }

      if (existing.sourceHash === record.sourceHash) {
        results.push({ externalId: record.externalId, disposition: "skipped" });
        continue;
      }
      if (!input.updateExisting) {
        results.push({
          externalId: record.externalId,
          disposition: "conflict",
        });
        continue;
      }

      await tx
        .update(timeTrackingImportQuarantine)
        .set({
          importRunId: run.id,
          externalBoardId: record.externalBoardId,
          externalCardId: record.externalCardId,
          externalMemberId: record.externalMemberId,
          reason: record.reason,
          durationSeconds: record.durationSeconds,
          normalizedRecord: record.normalizedRecord,
          sourceHash: record.sourceHash,
          overrideReference: record.overrideReference ?? null,
          resolvedAt: null,
        })
        .where(eq(timeTrackingImportQuarantine.id, existing.id));
      results.push({ externalId: record.externalId, disposition: "updated" });
    }

    return results;
  });
};
