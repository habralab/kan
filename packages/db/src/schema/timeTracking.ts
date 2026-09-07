import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { boards } from "./boards";
import { cards } from "./cards";
import { users } from "./users";
import { workspaceMembers } from "./workspaces";

export const DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS = 60;
export const DEFAULT_MINIMUM_TIME_ENTRY_SECONDS = 60;

export const timeTrackingEntryMethods = ["manual", "timer"] as const;
export type TimeTrackingEntryMethod = (typeof timeTrackingEntryMethods)[number];
export const timeTrackingEntryMethodEnum = pgEnum(
  "time_tracking_entry_method",
  timeTrackingEntryMethods,
);

export const timeTrackingBoardSettings = pgTable(
  "time_tracking_board_settings",
  {
    boardId: bigint("boardId", { mode: "number" })
      .primaryKey()
      .references(() => boards.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    roundingIntervalSeconds: integer("roundingIntervalSeconds")
      .notNull()
      .default(DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS),
    minimumDurationSeconds: integer("minimumDurationSeconds")
      .notNull()
      .default(DEFAULT_MINIMUM_TIME_ENTRY_SECONDS),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updatedAt"),
    updatedBy: uuid("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "time_tracking_board_settings_rounding_interval_check",
      sql`${table.roundingIntervalSeconds} BETWEEN 1 AND 3600`,
    ),
    check(
      "time_tracking_board_settings_minimum_duration_check",
      sql`${table.minimumDurationSeconds} BETWEEN 1 AND 86400`,
    ),
  ],
).enableRLS();

export const timeTrackingWorklogs = pgTable(
  "time_tracking_worklogs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    boardId: bigint("boardId", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    workspaceMemberId: bigint("workspaceMemberId", { mode: "number" })
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    workDate: date("workDate", { mode: "string" }).notNull(),
    durationSeconds: integer("durationSeconds").notNull(),
    comment: text("comment"),
    entryMethod: timeTrackingEntryMethodEnum("entryMethod").notNull(),
    timerStartedAt: timestamp("timerStartedAt", { withTimezone: true }),
    timerStoppedAt: timestamp("timerStoppedAt", { withTimezone: true }),
    timerTimezone: varchar("timerTimezone", { length: 64 }),
    rawElapsedSeconds: integer("rawElapsedSeconds"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updatedAt"),
    updatedBy: uuid("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    deletedAt: timestamp("deletedAt"),
    deletedBy: uuid("deletedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    check(
      "time_tracking_worklogs_duration_check",
      sql`${table.durationSeconds} > 0`,
    ),
    check(
      "time_tracking_worklogs_raw_elapsed_check",
      sql`${table.rawElapsedSeconds} IS NULL OR ${table.rawElapsedSeconds} >= 0`,
    ),
    check(
      "time_tracking_worklogs_work_date_check",
      sql`${table.workDate} BETWEEN DATE '1970-01-01' AND DATE '9999-12-31'`,
    ),
    check(
      "time_tracking_worklogs_entry_method_fields_check",
      sql`(
        ${table.entryMethod} = 'manual'
        AND ${table.timerStartedAt} IS NULL
        AND ${table.timerStoppedAt} IS NULL
        AND ${table.timerTimezone} IS NULL
        AND ${table.rawElapsedSeconds} IS NULL
      ) OR (
        ${table.entryMethod} = 'timer'
        AND ${table.timerStartedAt} IS NOT NULL
        AND ${table.timerStoppedAt} IS NOT NULL
        AND ${table.timerTimezone} IS NOT NULL
        AND ${table.rawElapsedSeconds} IS NOT NULL
        AND ${table.timerStoppedAt} >= ${table.timerStartedAt}
      )`,
    ),
    index("time_tracking_worklogs_card_date_idx")
      .on(table.cardId, table.workDate.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("time_tracking_worklogs_board_date_idx")
      .on(table.boardId, table.workDate.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("time_tracking_worklogs_member_date_idx")
      .on(table.workspaceMemberId, table.workDate.desc(), table.id.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    index("time_tracking_worklogs_board_card_idx")
      .on(table.boardId, table.cardId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("time_tracking_worklogs_board_all_idx").on(table.boardId),
  ],
).enableRLS();

export const timeTrackingActiveTimers = pgTable(
  "time_tracking_active_timers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceMemberId: bigint("workspaceMemberId", { mode: "number" })
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: "cascade" }),
    boardId: bigint("boardId", { mode: "number" })
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    cardId: bigint("cardId", { mode: "number" })
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    startedAt: timestamp("startedAt", { withTimezone: true }).notNull(),
    startTimezone: varchar("startTimezone", { length: 64 }).notNull(),
    comment: text("comment"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt"),
  },
  (table) => [
    uniqueIndex("time_tracking_active_timers_user_idx").on(table.userId),
    index("time_tracking_active_timers_board_idx").on(table.boardId),
    index("time_tracking_active_timers_card_idx").on(table.cardId),
  ],
).enableRLS();

export const timeTrackingBoardSettingsRelations = relations(
  timeTrackingBoardSettings,
  ({ one }) => ({
    board: one(boards, {
      fields: [timeTrackingBoardSettings.boardId],
      references: [boards.id],
    }),
    createdByUser: one(users, {
      fields: [timeTrackingBoardSettings.createdBy],
      references: [users.id],
      relationName: "timeTrackingBoardSettingsCreatedByUser",
    }),
    updatedByUser: one(users, {
      fields: [timeTrackingBoardSettings.updatedBy],
      references: [users.id],
      relationName: "timeTrackingBoardSettingsUpdatedByUser",
    }),
  }),
);

export const timeTrackingWorklogsRelations = relations(
  timeTrackingWorklogs,
  ({ one }) => ({
    board: one(boards, {
      fields: [timeTrackingWorklogs.boardId],
      references: [boards.id],
    }),
    card: one(cards, {
      fields: [timeTrackingWorklogs.cardId],
      references: [cards.id],
    }),
    workspaceMember: one(workspaceMembers, {
      fields: [timeTrackingWorklogs.workspaceMemberId],
      references: [workspaceMembers.id],
    }),
    createdByUser: one(users, {
      fields: [timeTrackingWorklogs.createdBy],
      references: [users.id],
      relationName: "timeTrackingWorklogsCreatedByUser",
    }),
    updatedByUser: one(users, {
      fields: [timeTrackingWorklogs.updatedBy],
      references: [users.id],
      relationName: "timeTrackingWorklogsUpdatedByUser",
    }),
    deletedByUser: one(users, {
      fields: [timeTrackingWorklogs.deletedBy],
      references: [users.id],
      relationName: "timeTrackingWorklogsDeletedByUser",
    }),
  }),
);

export const timeTrackingActiveTimersRelations = relations(
  timeTrackingActiveTimers,
  ({ one }) => ({
    user: one(users, {
      fields: [timeTrackingActiveTimers.userId],
      references: [users.id],
    }),
    workspaceMember: one(workspaceMembers, {
      fields: [timeTrackingActiveTimers.workspaceMemberId],
      references: [workspaceMembers.id],
    }),
    board: one(boards, {
      fields: [timeTrackingActiveTimers.boardId],
      references: [boards.id],
    }),
    card: one(cards, {
      fields: [timeTrackingActiveTimers.cardId],
      references: [cards.id],
    }),
  }),
);
