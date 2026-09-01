import { and, count, eq, isNull, lt, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  DEFAULT_MINIMUM_TIME_ENTRY_SECONDS,
  DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS,
  lists,
  timeTrackingActiveTimers,
  timeTrackingBoardSettings,
  timeTrackingWorklogs,
  workspaceMembers,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

export const timeTrackingRepositoryErrorCodes = [
  "BOARD_NOT_FOUND",
  "BOARD_ARCHIVED",
  "BOARD_DISABLED",
  "CARD_NOT_FOUND",
  "MEMBER_NOT_FOUND",
  "WORKLOG_NOT_FOUND",
] as const;

export type TimeTrackingRepositoryErrorCode =
  (typeof timeTrackingRepositoryErrorCodes)[number];

export class TimeTrackingRepositoryError extends Error {
  constructor(public readonly code: TimeTrackingRepositoryErrorCode) {
    super(code);
    this.name = "TimeTrackingRepositoryError";
  }
}

interface WorklogCursor {
  workDate: string;
  id: number;
}

const getBoardByPublicId = (db: dbClient, boardPublicId: string) =>
  db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      workspaceId: boards.workspaceId,
      isArchived: boards.isArchived,
    })
    .from(boards)
    .where(and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)))
    .limit(1);

export const getBoardSettings = async (db: dbClient, boardPublicId: string) => {
  const [board] = await getBoardByPublicId(db, boardPublicId);
  if (!board) return null;

  const [settings, activeTimerCount] = await Promise.all([
    db.query.timeTrackingBoardSettings.findFirst({
      where: eq(timeTrackingBoardSettings.boardId, board.id),
    }),
    db
      .select({ count: count() })
      .from(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.boardId, board.id)),
  ]);

  return {
    boardId: board.id,
    boardPublicId: board.publicId,
    workspaceId: board.workspaceId,
    isArchived: board.isArchived,
    enabled: settings?.enabled ?? false,
    roundingIntervalSeconds:
      settings?.roundingIntervalSeconds ??
      DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS,
    minimumDurationSeconds:
      settings?.minimumDurationSeconds ?? DEFAULT_MINIMUM_TIME_ENTRY_SECONDS,
    activeTimerCount: activeTimerCount[0]?.count ?? 0,
    updatedAt: settings?.updatedAt ?? null,
  };
};

export const updateBoardSettings = async (
  db: dbClient,
  input: {
    boardPublicId: string;
    enabled: boolean;
    actorUserId: string;
  },
) =>
  db.transaction(async (tx) => {
    const [board] = await tx
      .select({ id: boards.id, isArchived: boards.isArchived })
      .from(boards)
      .where(
        and(eq(boards.publicId, input.boardPublicId), isNull(boards.deletedAt)),
      )
      .limit(1);

    if (!board) throw new TimeTrackingRepositoryError("BOARD_NOT_FOUND");
    if (board.isArchived && input.enabled)
      throw new TimeTrackingRepositoryError("BOARD_ARCHIVED");

    const [settings] = await tx
      .insert(timeTrackingBoardSettings)
      .values({
        boardId: board.id,
        enabled: input.enabled,
        createdBy: input.actorUserId,
      })
      .onConflictDoUpdate({
        target: timeTrackingBoardSettings.boardId,
        set: {
          enabled: input.enabled,
          updatedAt: new Date(),
          updatedBy: input.actorUserId,
        },
      })
      .returning();

    return settings ?? null;
  });

export const createManualWorklog = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    workspaceMemberPublicId: string;
    workDate: string;
    durationSeconds: number;
    comment: string | null;
    actorUserId: string;
  },
) =>
  db.transaction(async (tx) => {
    const [card] = await tx
      .select({
        id: cards.id,
        boardId: boards.id,
        workspaceId: boards.workspaceId,
        boardArchived: boards.isArchived,
        settingsEnabled: timeTrackingBoardSettings.enabled,
      })
      .from(cards)
      .innerJoin(lists, eq(cards.listId, lists.id))
      .innerJoin(boards, eq(lists.boardId, boards.id))
      .leftJoin(
        timeTrackingBoardSettings,
        eq(boards.id, timeTrackingBoardSettings.boardId),
      )
      .where(
        and(
          eq(cards.publicId, input.cardPublicId),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);

    if (!card) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");
    if (card.boardArchived)
      throw new TimeTrackingRepositoryError("BOARD_ARCHIVED");
    if (!card.settingsEnabled)
      throw new TimeTrackingRepositoryError("BOARD_DISABLED");

    const [member] = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.publicId, input.workspaceMemberPublicId),
          eq(workspaceMembers.workspaceId, card.workspaceId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaceMembers.deletedAt),
        ),
      )
      .limit(1);

    if (!member) throw new TimeTrackingRepositoryError("MEMBER_NOT_FOUND");

    const [worklog] = await tx
      .insert(timeTrackingWorklogs)
      .values({
        publicId: generateUID(),
        boardId: card.boardId,
        cardId: card.id,
        workspaceMemberId: member.id,
        workDate: input.workDate,
        durationSeconds: input.durationSeconds,
        comment: input.comment,
        entryMethod: "manual",
        createdBy: input.actorUserId,
      })
      .returning();

    return worklog ?? null;
  });

export const updateWorklog = async (
  db: dbClient,
  input: {
    worklogPublicId: string;
    workspaceId: number;
    workspaceMemberPublicId?: string;
    workDate?: string;
    durationSeconds?: number;
    comment?: string | null;
    actorUserId: string;
  },
) =>
  db.transaction(async (tx) => {
    const [worklog] = await tx
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .innerJoin(boards, eq(timeTrackingWorklogs.boardId, boards.id))
      .where(
        and(
          eq(timeTrackingWorklogs.publicId, input.worklogPublicId),
          eq(boards.workspaceId, input.workspaceId),
          isNull(timeTrackingWorklogs.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1)
      .for("update");

    if (!worklog) throw new TimeTrackingRepositoryError("WORKLOG_NOT_FOUND");

    let workspaceMemberId: number | undefined;
    if (input.workspaceMemberPublicId) {
      const [member] = await tx
        .select({ id: workspaceMembers.id })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.publicId, input.workspaceMemberPublicId),
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.status, "active"),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1);

      if (!member) throw new TimeTrackingRepositoryError("MEMBER_NOT_FOUND");
      workspaceMemberId = member.id;
    }

    const [updated] = await tx
      .update(timeTrackingWorklogs)
      .set({
        workspaceMemberId,
        workDate: input.workDate,
        durationSeconds: input.durationSeconds,
        comment: input.comment,
        updatedAt: new Date(),
        updatedBy: input.actorUserId,
      })
      .where(
        and(
          eq(timeTrackingWorklogs.id, worklog.id),
          isNull(timeTrackingWorklogs.deletedAt),
        ),
      )
      .returning();

    if (!updated) throw new TimeTrackingRepositoryError("WORKLOG_NOT_FOUND");

    return updated;
  });

export const deleteWorklog = async (
  db: dbClient,
  input: {
    worklogPublicId: string;
    workspaceId: number;
    actorUserId: string;
  },
) =>
  db.transaction(async (tx) => {
    const [worklog] = await tx
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .innerJoin(boards, eq(timeTrackingWorklogs.boardId, boards.id))
      .where(
        and(
          eq(timeTrackingWorklogs.publicId, input.worklogPublicId),
          eq(boards.workspaceId, input.workspaceId),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1);

    if (!worklog) throw new TimeTrackingRepositoryError("WORKLOG_NOT_FOUND");

    const deletedAt = new Date();
    const [deleted] = await tx
      .update(timeTrackingWorklogs)
      .set({ deletedAt, deletedBy: input.actorUserId })
      .where(
        and(
          eq(timeTrackingWorklogs.id, worklog.id),
          isNull(timeTrackingWorklogs.deletedAt),
        ),
      )
      .returning({ publicId: timeTrackingWorklogs.publicId });

    return { publicId: input.worklogPublicId, deleted: Boolean(deleted) };
  });

export const listWorklogsByCard = async (
  db: dbClient,
  input: {
    cardPublicId: string;
    limit: number;
    cursor?: WorklogCursor;
  },
) => {
  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .where(
      and(
        eq(cards.publicId, input.cardPublicId),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
      ),
    )
    .limit(1);

  if (!card) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");

  const cursorCondition = input.cursor
    ? or(
        lt(timeTrackingWorklogs.workDate, input.cursor.workDate),
        and(
          eq(timeTrackingWorklogs.workDate, input.cursor.workDate),
          lt(timeTrackingWorklogs.id, input.cursor.id),
        ),
      )
    : undefined;

  const rows = await db.query.timeTrackingWorklogs.findMany({
    columns: {
      id: true,
      publicId: true,
      workDate: true,
      durationSeconds: true,
      comment: true,
      entryMethod: true,
      timerStartedAt: true,
      timerStoppedAt: true,
      timerTimezone: true,
      rawElapsedSeconds: true,
      createdAt: true,
      createdBy: true,
      updatedAt: true,
      updatedBy: true,
    },
    with: {
      workspaceMember: {
        columns: {
          publicId: true,
          email: true,
          status: true,
        },
        with: {
          user: {
            columns: {
              name: true,
              email: true,
            },
          },
        },
      },
    },
    where: and(
      eq(timeTrackingWorklogs.cardId, card.id),
      isNull(timeTrackingWorklogs.deletedAt),
      cursorCondition,
    ),
    orderBy: (worklogs, { desc }) => [
      desc(worklogs.workDate),
      desc(worklogs.id),
    ],
    limit: input.limit + 1,
  });

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor:
      hasMore && last ? { workDate: last.workDate, id: last.id } : null,
  };
};
