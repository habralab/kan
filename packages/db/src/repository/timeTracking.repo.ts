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
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import {
  getWorkDateInTimezone,
  roundTimerDuration,
} from "./timeTracking.utils";

export const timeTrackingRepositoryErrorCodes = [
  "BOARD_NOT_FOUND",
  "BOARD_ARCHIVED",
  "BOARD_DISABLED",
  "CARD_NOT_FOUND",
  "MEMBER_NOT_FOUND",
  "TIMER_CONFLICT",
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

const hasDatabaseErrorCode = (error: unknown, code: string): boolean => {
  if (!error || typeof error !== "object") return false;

  if ("code" in error && error.code === code) return true;
  return "cause" in error && hasDatabaseErrorCode(error.cause, code);
};

export const getActiveTimer = async (db: dbClient, userId: string) => {
  const [timer] = await db
    .select({
      id: timeTrackingActiveTimers.id,
      publicId: timeTrackingActiveTimers.publicId,
      startedAt: timeTrackingActiveTimers.startedAt,
      startTimezone: timeTrackingActiveTimers.startTimezone,
      comment: timeTrackingActiveTimers.comment,
      workspaceMemberId: timeTrackingActiveTimers.workspaceMemberId,
      memberUserId: workspaceMembers.userId,
      memberStatus: workspaceMembers.status,
      memberDeletedAt: workspaceMembers.deletedAt,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      cardNumber: cards.cardNumber,
      boardPublicId: boards.publicId,
      boardName: boards.name,
      workspacePublicId: workspaces.publicId,
      workspaceName: workspaces.name,
    })
    .from(timeTrackingActiveTimers)
    .innerJoin(cards, eq(timeTrackingActiveTimers.cardId, cards.id))
    .innerJoin(boards, eq(timeTrackingActiveTimers.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .innerJoin(
      workspaceMembers,
      eq(timeTrackingActiveTimers.workspaceMemberId, workspaceMembers.id),
    )
    .where(eq(timeTrackingActiveTimers.userId, userId))
    .limit(1);

  return timer ?? null;
};

export const startTimer = async (
  db: dbClient,
  input: {
    userId: string;
    cardPublicId: string;
    timezone: string;
    comment: string | null;
    startedAt?: Date;
  },
) => {
  const requestedStartedAt = input.startedAt ?? new Date();
  const observedTimer = await db.query.timeTrackingActiveTimers.findFirst({
    columns: { id: true },
    where: eq(timeTrackingActiveTimers.userId, input.userId),
  });

  try {
    return await db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update");

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
            eq(workspaceMembers.userId, input.userId),
            eq(workspaceMembers.workspaceId, card.workspaceId),
            eq(workspaceMembers.status, "active"),
            isNull(workspaceMembers.deletedAt),
          ),
        )
        .limit(1);

      if (!member) throw new TimeTrackingRepositoryError("MEMBER_NOT_FOUND");

      const [currentTimer] = await tx
        .select()
        .from(timeTrackingActiveTimers)
        .where(eq(timeTrackingActiveTimers.userId, input.userId))
        .limit(1)
        .for("update");

      if (currentTimer?.cardId === card.id) {
        return {
          timer: currentTimer,
          autoStoppedWorklog: null,
          unchanged: true,
        };
      }
      if ((currentTimer?.id ?? null) !== (observedTimer?.id ?? null))
        throw new TimeTrackingRepositoryError("TIMER_CONFLICT");

      let autoStoppedWorklog: typeof timeTrackingWorklogs.$inferSelect | null =
        null;

      if (currentTimer) {
        const [settings] = await tx
          .select({
            roundingIntervalSeconds:
              timeTrackingBoardSettings.roundingIntervalSeconds,
            minimumDurationSeconds:
              timeTrackingBoardSettings.minimumDurationSeconds,
          })
          .from(timeTrackingBoardSettings)
          .where(eq(timeTrackingBoardSettings.boardId, currentTimer.boardId))
          .limit(1);
        const stoppedAt =
          requestedStartedAt < currentTimer.startedAt
            ? currentTimer.startedAt
            : requestedStartedAt;
        const rawElapsedSeconds = Math.floor(
          (stoppedAt.getTime() - currentTimer.startedAt.getTime()) / 1000,
        );

        const [completedWorklog] = await tx
          .insert(timeTrackingWorklogs)
          .values({
            publicId: generateUID(),
            boardId: currentTimer.boardId,
            cardId: currentTimer.cardId,
            workspaceMemberId: currentTimer.workspaceMemberId,
            workDate: getWorkDateInTimezone(stoppedAt, input.timezone),
            durationSeconds: roundTimerDuration({
              rawElapsedSeconds,
              roundingIntervalSeconds: settings?.roundingIntervalSeconds,
              minimumDurationSeconds: settings?.minimumDurationSeconds,
            }),
            comment: currentTimer.comment,
            entryMethod: "timer",
            timerStartedAt: currentTimer.startedAt,
            timerStoppedAt: stoppedAt,
            timerTimezone: input.timezone,
            rawElapsedSeconds,
            createdBy: input.userId,
          })
          .returning();
        autoStoppedWorklog = completedWorklog ?? null;

        await tx
          .delete(timeTrackingActiveTimers)
          .where(eq(timeTrackingActiveTimers.id, currentTimer.id));
      }

      const [timer] = await tx
        .insert(timeTrackingActiveTimers)
        .values({
          publicId: generateUID(),
          userId: input.userId,
          workspaceMemberId: member.id,
          boardId: card.boardId,
          cardId: card.id,
          startedAt: requestedStartedAt,
          startTimezone: input.timezone,
          comment: input.comment,
        })
        .returning();

      if (!timer) throw new TimeTrackingRepositoryError("TIMER_CONFLICT");

      return { timer, autoStoppedWorklog, unchanged: false };
    });
  } catch (error) {
    if (hasDatabaseErrorCode(error, "23505"))
      throw new TimeTrackingRepositoryError("TIMER_CONFLICT");
    throw error;
  }
};

export const stopTimer = async (
  db: dbClient,
  input: {
    userId: string;
    timezone: string;
    stoppedAt?: Date;
  },
) =>
  db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");

    const [timer] = await tx
      .select()
      .from(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.userId, input.userId))
      .limit(1)
      .for("update");

    if (!timer) return { stopped: false, worklog: null } as const;

    const requestedStoppedAt = input.stoppedAt ?? new Date();
    const stoppedAt =
      requestedStoppedAt < timer.startedAt
        ? timer.startedAt
        : requestedStoppedAt;
    const rawElapsedSeconds = Math.floor(
      (stoppedAt.getTime() - timer.startedAt.getTime()) / 1000,
    );
    const [settings] = await tx
      .select({
        roundingIntervalSeconds:
          timeTrackingBoardSettings.roundingIntervalSeconds,
        minimumDurationSeconds:
          timeTrackingBoardSettings.minimumDurationSeconds,
      })
      .from(timeTrackingBoardSettings)
      .where(eq(timeTrackingBoardSettings.boardId, timer.boardId))
      .limit(1);
    const [worklog] = await tx
      .insert(timeTrackingWorklogs)
      .values({
        publicId: generateUID(),
        boardId: timer.boardId,
        cardId: timer.cardId,
        workspaceMemberId: timer.workspaceMemberId,
        workDate: getWorkDateInTimezone(stoppedAt, input.timezone),
        durationSeconds: roundTimerDuration({
          rawElapsedSeconds,
          roundingIntervalSeconds: settings?.roundingIntervalSeconds,
          minimumDurationSeconds: settings?.minimumDurationSeconds,
        }),
        comment: timer.comment,
        entryMethod: "timer",
        timerStartedAt: timer.startedAt,
        timerStoppedAt: stoppedAt,
        timerTimezone: input.timezone,
        rawElapsedSeconds,
        createdBy: input.userId,
      })
      .returning();

    await tx
      .delete(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.id, timer.id));

    return { stopped: true, worklog: worklog ?? null } as const;
  });

export const discardTimer = async (db: dbClient, userId: string) => {
  const discarded = await db.transaction(async (tx) => {
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");

    const [timer] = await tx
      .delete(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.userId, userId))
      .returning({ publicId: timeTrackingActiveTimers.publicId });

    return timer;
  });

  return { discarded: Boolean(discarded) };
};
