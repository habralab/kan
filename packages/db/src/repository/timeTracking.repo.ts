import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cards,
  cardsToLabels,
  DEFAULT_MINIMUM_TIME_ENTRY_SECONDS,
  DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS,
  labels,
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
  "BOARD_NOT_REGULAR",
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

export interface WorklogCursor {
  workDate: string;
  id: number;
}

export interface TimeTrackingReportFilters {
  dateFrom?: string;
  dateTo?: string;
  memberPublicIds?: string[];
  cardPublicIds?: string[];
  listPublicIds?: string[];
  labelPublicIds?: string[];
}

export type TimeTrackingReportGroupBy = "member" | "card" | "list";
export type TimeTrackingExportGroupBy = TimeTrackingReportGroupBy | "date";

export const UNAVAILABLE_TIME_TRACKING_MEMBER_GROUP_ID = "unavailable-member";
export const DELETED_TIME_TRACKING_CARD_GROUP_ID = "deleted-card";

const getReportConditions = (
  db: dbClient,
  boardId: number,
  filters: TimeTrackingReportFilters,
  cursor?: WorklogCursor,
) => [
  eq(timeTrackingWorklogs.boardId, boardId),
  isNull(timeTrackingWorklogs.deletedAt),
  filters.dateFrom
    ? gte(timeTrackingWorklogs.workDate, filters.dateFrom)
    : undefined,
  filters.dateTo
    ? lte(timeTrackingWorklogs.workDate, filters.dateTo)
    : undefined,
  filters.memberPublicIds?.length
    ? inArray(
        timeTrackingWorklogs.workspaceMemberId,
        db
          .select({ id: workspaceMembers.id })
          .from(workspaceMembers)
          .where(inArray(workspaceMembers.publicId, filters.memberPublicIds)),
      )
    : undefined,
  filters.cardPublicIds?.length
    ? inArray(
        timeTrackingWorklogs.cardId,
        db
          .select({ id: cards.id })
          .from(cards)
          .where(inArray(cards.publicId, filters.cardPublicIds)),
      )
    : undefined,
  filters.listPublicIds?.length
    ? inArray(
        timeTrackingWorklogs.cardId,
        db
          .select({ id: cards.id })
          .from(cards)
          .innerJoin(lists, eq(cards.listId, lists.id))
          .where(inArray(lists.publicId, filters.listPublicIds)),
      )
    : undefined,
  filters.labelPublicIds?.length
    ? inArray(
        timeTrackingWorklogs.cardId,
        db
          .select({ id: cardsToLabels.cardId })
          .from(cardsToLabels)
          .innerJoin(labels, eq(cardsToLabels.labelId, labels.id))
          .where(inArray(labels.publicId, filters.labelPublicIds)),
      )
    : undefined,
  cursor
    ? or(
        lt(timeTrackingWorklogs.workDate, cursor.workDate),
        and(
          eq(timeTrackingWorklogs.workDate, cursor.workDate),
          lt(timeTrackingWorklogs.id, cursor.id),
        ),
      )
    : undefined,
];

export const getCardTimeTrackingContext = async (
  db: dbClient,
  cardPublicId: string,
) => {
  const [card] = await db
    .select({
      cardId: cards.id,
      cardPublicId: cards.publicId,
      boardPublicId: boards.publicId,
      workspaceId: boards.workspaceId,
      isArchived: boards.isArchived,
      settingsEnabled: timeTrackingBoardSettings.enabled,
      showEmailsToMembers: workspaces.showEmailsToMembers,
    })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .leftJoin(
      timeTrackingBoardSettings,
      eq(boards.id, timeTrackingBoardSettings.boardId),
    )
    .where(
      and(
        eq(cards.publicId, cardPublicId),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  return card ?? null;
};

export const getCardWorklogSummary = async (
  db: dbClient,
  cardId: number,
  dateRange?: { dateFrom: string; dateTo: string },
) => {
  const durationSeconds =
    sql<number>`SUM(${timeTrackingWorklogs.durationSeconds})`.mapWith(Number);
  const memberTotals = await db
    .select({
      durationSeconds,
      entryCount: count(),
      memberPublicId: workspaceMembers.publicId,
      memberEmail: workspaceMembers.email,
      memberStatus: workspaceMembers.status,
      memberDeletedAt: workspaceMembers.deletedAt,
      memberUserId: workspaceMembers.userId,
      memberDisplayName: users.name,
      userEmail: users.email,
      showEmailsToMembers: workspaces.showEmailsToMembers,
    })
    .from(timeTrackingWorklogs)
    .leftJoin(
      workspaceMembers,
      eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
    )
    .leftJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(timeTrackingWorklogs.cardId, cardId),
        isNull(timeTrackingWorklogs.deletedAt),
        dateRange
          ? gte(timeTrackingWorklogs.workDate, dateRange.dateFrom)
          : undefined,
        dateRange
          ? lte(timeTrackingWorklogs.workDate, dateRange.dateTo)
          : undefined,
      ),
    )
    .groupBy(workspaceMembers.id, users.id, workspaces.showEmailsToMembers)
    .orderBy(desc(durationSeconds), workspaceMembers.email);

  return {
    totalSeconds: memberTotals.reduce(
      (total, member) => total + member.durationSeconds,
      0,
    ),
    entryCount: memberTotals.reduce(
      (total, member) => total + member.entryCount,
      0,
    ),
    memberTotals,
  };
};

export const getTimeTrackingMemberOptions = (
  db: dbClient,
  workspaceId: number,
) =>
  db
    .select({
      publicId: workspaceMembers.publicId,
      email: workspaceMembers.email,
      status: workspaceMembers.status,
      deletedAt: workspaceMembers.deletedAt,
      userId: workspaceMembers.userId,
      displayName: users.name,
      userEmail: users.email,
      showEmailsToMembers: workspaces.showEmailsToMembers,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .leftJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .orderBy(users.name, workspaceMembers.email);

export const getActiveWorkspaceMemberForUser = async (
  db: dbClient,
  workspaceId: number,
  userId: string,
) => {
  const [member] = await db
    .select({
      id: workspaceMembers.id,
      publicId: workspaceMembers.publicId,
    })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    )
    .limit(1);

  return member ?? null;
};

export const getWorklogContext = async (
  db: dbClient,
  worklogPublicId: string,
) => {
  const [worklog] = await db
    .select({
      workspaceId: boards.workspaceId,
      memberUserId: workspaceMembers.userId,
      memberStatus: workspaceMembers.status,
      memberDeletedAt: workspaceMembers.deletedAt,
      deletedAt: timeTrackingWorklogs.deletedAt,
    })
    .from(timeTrackingWorklogs)
    .innerJoin(boards, eq(timeTrackingWorklogs.boardId, boards.id))
    .leftJoin(
      workspaceMembers,
      eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
    )
    .where(
      and(
        eq(timeTrackingWorklogs.publicId, worklogPublicId),
        isNull(boards.deletedAt),
      ),
    )
    .limit(1);

  return worklog ?? null;
};

export const getWorklogByPublicId = (db: dbClient, publicId: string) =>
  db.query.timeTrackingWorklogs.findFirst({
    columns: {
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
      updatedAt: true,
      deletedAt: true,
    },
    with: {
      workspaceMember: {
        columns: {
          publicId: true,
          email: true,
          status: true,
          deletedAt: true,
          userId: true,
        },
        with: {
          user: { columns: { name: true, email: true } },
          workspace: { columns: { showEmailsToMembers: true } },
        },
      },
      card: {
        columns: {
          publicId: true,
          title: true,
          cardNumber: true,
          deletedAt: true,
        },
        with: {
          list: { columns: { publicId: true, name: true } },
        },
      },
      createdByUser: { columns: { name: true } },
      updatedByUser: { columns: { name: true } },
    },
    where: eq(timeTrackingWorklogs.publicId, publicId),
  });

const getBoardByPublicId = (db: dbClient, boardPublicId: string) =>
  db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      name: boards.name,
      workspaceId: boards.workspaceId,
      isArchived: boards.isArchived,
      type: boards.type,
      createdBy: boards.createdBy,
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
    boardName: board.name,
    workspaceId: board.workspaceId,
    isArchived: board.isArchived,
    type: board.type,
    createdBy: board.createdBy,
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
      .select({
        id: boards.id,
        type: boards.type,
        isArchived: boards.isArchived,
      })
      .from(boards)
      .where(
        and(eq(boards.publicId, input.boardPublicId), isNull(boards.deletedAt)),
      )
      .limit(1)
      .for("update");

    if (!board) throw new TimeTrackingRepositoryError("BOARD_NOT_FOUND");
    if (board.type !== "regular" && input.enabled)
      throw new TimeTrackingRepositoryError("BOARD_NOT_REGULAR");
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
    // Serialize board resolution with cross-board card moves.
    const [lockedCard] = await tx
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(eq(cards.publicId, input.cardPublicId), isNull(cards.deletedAt)),
      )
      .limit(1)
      .for("share");

    if (!lockedCard) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");

    const [card] = await tx
      .select({
        id: cards.id,
        boardId: boards.id,
        workspaceId: boards.workspaceId,
        boardArchived: boards.isArchived,
        boardType: boards.type,
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
          eq(cards.id, lockedCard.id),
          isNull(cards.deletedAt),
          isNull(lists.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1)
      .for("share", { of: boards });

    if (!card) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");
    if (card.boardType !== "regular")
      throw new TimeTrackingRepositoryError("BOARD_NOT_REGULAR");
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
    expectedMemberUserId?: string;
  },
) =>
  db.transaction(async (tx) => {
    const [worklog] = await tx
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .innerJoin(boards, eq(timeTrackingWorklogs.boardId, boards.id))
      .innerJoin(
        workspaceMembers,
        eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          eq(timeTrackingWorklogs.publicId, input.worklogPublicId),
          eq(boards.workspaceId, input.workspaceId),
          input.expectedMemberUserId
            ? eq(workspaceMembers.userId, input.expectedMemberUserId)
            : undefined,
          isNull(timeTrackingWorklogs.deletedAt),
          isNull(boards.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: timeTrackingWorklogs });

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
    expectedMemberUserId?: string;
  },
) =>
  db.transaction(async (tx) => {
    const [worklog] = await tx
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .innerJoin(boards, eq(timeTrackingWorklogs.boardId, boards.id))
      .innerJoin(
        workspaceMembers,
        eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
      )
      .where(
        and(
          eq(timeTrackingWorklogs.publicId, input.worklogPublicId),
          eq(boards.workspaceId, input.workspaceId),
          input.expectedMemberUserId
            ? eq(workspaceMembers.userId, input.expectedMemberUserId)
            : undefined,
          isNull(boards.deletedAt),
        ),
      )
      .limit(1)
      .for("update", { of: timeTrackingWorklogs });

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
    dateFrom?: string;
    dateTo?: string;
    workspaceMemberPublicId?: string;
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
      updatedAt: true,
    },
    with: {
      workspaceMember: {
        columns: {
          publicId: true,
          email: true,
          status: true,
          deletedAt: true,
          userId: true,
        },
        with: {
          user: {
            columns: {
              name: true,
              email: true,
            },
          },
          workspace: { columns: { showEmailsToMembers: true } },
        },
      },
      card: {
        columns: {
          publicId: true,
          title: true,
          cardNumber: true,
          deletedAt: true,
        },
        with: {
          list: { columns: { publicId: true, name: true } },
        },
      },
      createdByUser: { columns: { name: true } },
      updatedByUser: { columns: { name: true } },
    },
    where: and(
      eq(timeTrackingWorklogs.cardId, card.id),
      isNull(timeTrackingWorklogs.deletedAt),
      input.dateFrom
        ? gte(timeTrackingWorklogs.workDate, input.dateFrom)
        : undefined,
      input.dateTo
        ? lte(timeTrackingWorklogs.workDate, input.dateTo)
        : undefined,
      input.workspaceMemberPublicId
        ? inArray(
            timeTrackingWorklogs.workspaceMemberId,
            db
              .select({ id: workspaceMembers.id })
              .from(workspaceMembers)
              .where(
                eq(workspaceMembers.publicId, input.workspaceMemberPublicId),
              ),
          )
        : undefined,
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

export const listBoardWorklogs = async (
  db: dbClient,
  input: {
    boardId: number;
    filters: TimeTrackingReportFilters;
    limit: number;
    cursor?: WorklogCursor;
  },
) => {
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
      updatedAt: true,
    },
    with: {
      workspaceMember: {
        columns: {
          publicId: true,
          email: true,
          status: true,
          deletedAt: true,
          userId: true,
        },
        with: {
          user: { columns: { name: true, email: true } },
          workspace: { columns: { showEmailsToMembers: true } },
        },
      },
      card: {
        columns: {
          publicId: true,
          title: true,
          cardNumber: true,
          deletedAt: true,
        },
        with: {
          list: { columns: { publicId: true, name: true } },
          labels: {
            columns: {},
            with: {
              label: {
                columns: {
                  publicId: true,
                  name: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
      createdByUser: { columns: { name: true } },
      updatedByUser: { columns: { name: true } },
    },
    where: and(
      ...getReportConditions(db, input.boardId, input.filters, input.cursor),
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

export const getBoardWorklogSummary = async (
  db: dbClient,
  boardId: number,
  filters: TimeTrackingReportFilters,
) => {
  const [summary] = await db
    .select({
      totalSeconds:
        sql<number>`COALESCE(SUM(${timeTrackingWorklogs.durationSeconds}), 0)`.mapWith(
          Number,
        ),
      entryCount: count(),
      memberCount: countDistinct(timeTrackingWorklogs.workspaceMemberId),
      cardCount: countDistinct(timeTrackingWorklogs.cardId),
    })
    .from(timeTrackingWorklogs)
    .where(and(...getReportConditions(db, boardId, filters)));

  return {
    totalSeconds: summary?.totalSeconds ?? 0,
    entryCount: summary?.entryCount ?? 0,
    memberCount: summary?.memberCount ?? 0,
    cardCount: summary?.cardCount ?? 0,
  };
};

export const getBoardCardTotals = async (db: dbClient, boardId: number) => {
  const totalSeconds =
    sql<number>`SUM(${timeTrackingWorklogs.durationSeconds})`.mapWith(Number);

  return db
    .select({
      cardPublicId: cards.publicId,
      totalSeconds,
    })
    .from(timeTrackingWorklogs)
    .innerJoin(cards, eq(timeTrackingWorklogs.cardId, cards.id))
    .where(
      and(
        eq(timeTrackingWorklogs.boardId, boardId),
        isNull(timeTrackingWorklogs.deletedAt),
        isNull(cards.deletedAt),
      ),
    )
    .groupBy(cards.id);
};

export const getBoardTimeTrackingMoveBlockers = async (
  db: dbClient,
  boardId: number,
) => {
  const [worklog, activeTimer] = await Promise.all([
    db
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .where(eq(timeTrackingWorklogs.boardId, boardId))
      .limit(1),
    db
      .select({ id: timeTrackingActiveTimers.id })
      .from(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.boardId, boardId))
      .limit(1),
  ]);

  return {
    hasWorklogs: worklog.length > 0,
    hasActiveTimers: activeTimer.length > 0,
  };
};

export const getCardTimeTrackingMoveBlockers = async (
  db: dbClient,
  cardId: number,
) => {
  const [worklog, activeTimer] = await Promise.all([
    db
      .select({ id: timeTrackingWorklogs.id })
      .from(timeTrackingWorklogs)
      .where(eq(timeTrackingWorklogs.cardId, cardId))
      .limit(1),
    db
      .select({ id: timeTrackingActiveTimers.id })
      .from(timeTrackingActiveTimers)
      .where(eq(timeTrackingActiveTimers.cardId, cardId))
      .limit(1),
  ]);

  return {
    hasWorklogs: worklog.length > 0,
    hasActiveTimers: activeTimer.length > 0,
  };
};

export const getBoardWorklogGroups = async (
  db: dbClient,
  boardId: number,
  filters: TimeTrackingReportFilters,
  groupBy: TimeTrackingExportGroupBy,
) => {
  const durationSeconds =
    sql<number>`SUM(${timeTrackingWorklogs.durationSeconds})`.mapWith(Number);
  const entryCount = count();
  const conditions = and(...getReportConditions(db, boardId, filters));

  if (groupBy === "member") {
    const [rows, unavailable] = await Promise.all([
      db
        .select({
          publicId: workspaceMembers.publicId,
          durationSeconds,
          entryCount,
          email: workspaceMembers.email,
          status: workspaceMembers.status,
          deletedAt: workspaceMembers.deletedAt,
          displayName: users.name,
          userEmail: users.email,
          showEmailsToMembers: workspaces.showEmailsToMembers,
        })
        .from(timeTrackingWorklogs)
        .innerJoin(
          workspaceMembers,
          eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
        )
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .leftJoin(users, eq(workspaceMembers.userId, users.id))
        .where(conditions)
        .groupBy(workspaceMembers.id, users.id, workspaces.showEmailsToMembers)
        .orderBy(desc(durationSeconds), workspaceMembers.email),
      db
        .select({ durationSeconds, entryCount })
        .from(timeTrackingWorklogs)
        .where(and(conditions, isNull(timeTrackingWorklogs.workspaceMemberId))),
    ]);
    return [
      ...rows.map((row) => ({
        publicId: row.publicId,
        label: null,
        member: row,
        durationSeconds: row.durationSeconds,
        entryCount: row.entryCount,
      })),
      ...(unavailable[0]?.entryCount
        ? [
            {
              publicId: UNAVAILABLE_TIME_TRACKING_MEMBER_GROUP_ID,
              label: "Unavailable member",
              member: null,
              durationSeconds: unavailable[0].durationSeconds,
              entryCount: unavailable[0].entryCount,
            },
          ]
        : []),
    ].sort((left, right) => right.durationSeconds - left.durationSeconds);
  }

  if (groupBy === "card") {
    const [rows, deleted] = await Promise.all([
      db
        .select({
          publicId: cards.publicId,
          label: cards.title,
          durationSeconds,
          entryCount,
        })
        .from(timeTrackingWorklogs)
        .innerJoin(cards, eq(timeTrackingWorklogs.cardId, cards.id))
        .where(conditions)
        .groupBy(cards.id)
        .orderBy(desc(durationSeconds), cards.title),
      db
        .select({ durationSeconds, entryCount })
        .from(timeTrackingWorklogs)
        .where(and(conditions, isNull(timeTrackingWorklogs.cardId))),
    ]);
    const groups = rows.map((row) => ({ ...row, member: null }));
    if (deleted[0]?.entryCount)
      groups.push({
        publicId: DELETED_TIME_TRACKING_CARD_GROUP_ID,
        label: "Deleted card",
        durationSeconds: deleted[0].durationSeconds,
        entryCount: deleted[0].entryCount,
        member: null,
      });
    return groups.sort(
      (left, right) => right.durationSeconds - left.durationSeconds,
    );
  }

  if (groupBy === "date") {
    const rows = await db
      .select({
        publicId: timeTrackingWorklogs.workDate,
        label: timeTrackingWorklogs.workDate,
        durationSeconds,
        entryCount,
      })
      .from(timeTrackingWorklogs)
      .where(conditions)
      .groupBy(timeTrackingWorklogs.workDate)
      .orderBy(desc(timeTrackingWorklogs.workDate));

    return rows.map((row) => ({ ...row, member: null }));
  }

  const [rows, deleted] = await Promise.all([
    db
      .select({
        publicId: lists.publicId,
        label: lists.name,
        durationSeconds,
        entryCount,
      })
      .from(timeTrackingWorklogs)
      .innerJoin(cards, eq(timeTrackingWorklogs.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(conditions)
      .groupBy(lists.id)
      .orderBy(desc(durationSeconds), lists.name),
    db
      .select({ durationSeconds, entryCount })
      .from(timeTrackingWorklogs)
      .where(and(conditions, isNull(timeTrackingWorklogs.cardId))),
  ]);
  const groups = rows.map((row) => ({ ...row, member: null }));
  if (deleted[0]?.entryCount)
    groups.push({
      publicId: DELETED_TIME_TRACKING_CARD_GROUP_ID,
      label: "Deleted card",
      durationSeconds: deleted[0].durationSeconds,
      entryCount: deleted[0].entryCount,
      member: null,
    });
  return groups.sort(
    (left, right) => right.durationSeconds - left.durationSeconds,
  );
};

export const getBoardReportOptions = async (db: dbClient, boardId: number) => {
  const activeWorklogs = and(
    eq(timeTrackingWorklogs.boardId, boardId),
    isNull(timeTrackingWorklogs.deletedAt),
  );
  const [members, reportCards, reportLists, reportLabels] = await Promise.all([
    db
      .selectDistinct({
        publicId: workspaceMembers.publicId,
        email: workspaceMembers.email,
        status: workspaceMembers.status,
        deletedAt: workspaceMembers.deletedAt,
        userId: workspaceMembers.userId,
        displayName: users.name,
        userEmail: users.email,
        showEmailsToMembers: workspaces.showEmailsToMembers,
      })
      .from(timeTrackingWorklogs)
      .innerJoin(
        workspaceMembers,
        eq(timeTrackingWorklogs.workspaceMemberId, workspaceMembers.id),
      )
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .leftJoin(users, eq(workspaceMembers.userId, users.id))
      .where(activeWorklogs)
      .orderBy(users.name, workspaceMembers.email),
    db
      .selectDistinct({
        publicId: cards.publicId,
        title: cards.title,
        cardNumber: cards.cardNumber,
        listPublicId: lists.publicId,
      })
      .from(timeTrackingWorklogs)
      .innerJoin(cards, eq(timeTrackingWorklogs.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(activeWorklogs)
      .orderBy(cards.title),
    db
      .selectDistinct({ publicId: lists.publicId, name: lists.name })
      .from(timeTrackingWorklogs)
      .innerJoin(cards, eq(timeTrackingWorklogs.cardId, cards.id))
      .innerJoin(lists, eq(cards.listId, lists.id))
      .where(activeWorklogs)
      .orderBy(lists.name),
    db
      .selectDistinct({ publicId: labels.publicId, name: labels.name })
      .from(timeTrackingWorklogs)
      .innerJoin(
        cardsToLabels,
        eq(timeTrackingWorklogs.cardId, cardsToLabels.cardId),
      )
      .innerJoin(labels, eq(cardsToLabels.labelId, labels.id))
      .where(and(activeWorklogs, isNull(labels.deletedAt)))
      .orderBy(labels.name),
  ]);

  members.sort(
    (left, right) =>
      Number(left.status !== "active" || left.deletedAt !== null) -
      Number(right.status !== "active" || right.deletedAt !== null),
  );

  return {
    members,
    cards: reportCards,
    lists: reportLists,
    labels: reportLabels,
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
      workspaceId: boards.workspaceId,
      workspaceDeletedAt: workspaces.deletedAt,
      cardPublicId: cards.publicId,
      cardTitle: cards.title,
      cardNumber: cards.cardNumber,
      cardDeletedAt: cards.deletedAt,
      listDeletedAt: lists.deletedAt,
      boardPublicId: boards.publicId,
      boardName: boards.name,
      boardDeletedAt: boards.deletedAt,
      workspacePublicId: workspaces.publicId,
      workspaceName: workspaces.name,
    })
    .from(timeTrackingActiveTimers)
    .innerJoin(cards, eq(timeTrackingActiveTimers.cardId, cards.id))
    .innerJoin(lists, eq(cards.listId, lists.id))
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

      // Serialize board resolution with cross-board card moves.
      const [lockedCard] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(eq(cards.publicId, input.cardPublicId), isNull(cards.deletedAt)),
        )
        .limit(1)
        .for("share");

      if (!lockedCard) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");

      const [card] = await tx
        .select({
          id: cards.id,
          boardId: boards.id,
          workspaceId: boards.workspaceId,
          boardArchived: boards.isArchived,
          boardType: boards.type,
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
            eq(cards.id, lockedCard.id),
            isNull(cards.deletedAt),
            isNull(lists.deletedAt),
            isNull(boards.deletedAt),
          ),
        )
        .limit(1)
        .for("share", { of: boards });

      if (!card) throw new TimeTrackingRepositoryError("CARD_NOT_FOUND");
      if (card.boardType !== "regular")
        throw new TimeTrackingRepositoryError("BOARD_NOT_REGULAR");
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
            workDate: getWorkDateInTimezone(
              currentTimer.startedAt,
              currentTimer.startTimezone,
            ),
            durationSeconds: roundTimerDuration({
              rawElapsedSeconds,
              roundingIntervalSeconds: settings?.roundingIntervalSeconds,
              minimumDurationSeconds: settings?.minimumDurationSeconds,
            }),
            comment: currentTimer.comment,
            entryMethod: "timer",
            timerStartedAt: currentTimer.startedAt,
            timerStoppedAt: stoppedAt,
            timerTimezone: currentTimer.startTimezone,
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
        workDate: getWorkDateInTimezone(timer.startedAt, timer.startTimezone),
        durationSeconds: roundTimerDuration({
          rawElapsedSeconds,
          roundingIntervalSeconds: settings?.roundingIntervalSeconds,
          minimumDurationSeconds: settings?.minimumDurationSeconds,
        }),
        comment: timer.comment,
        entryMethod: "timer",
        timerStartedAt: timer.startedAt,
        timerStoppedAt: stoppedAt,
        timerTimezone: timer.startTimezone,
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
