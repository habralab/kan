import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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

export const timeTrackingEntryMethods = ["manual", "timer", "import"] as const;
export type TimeTrackingEntryMethod = (typeof timeTrackingEntryMethods)[number];
export const timeTrackingEntryMethodEnum = pgEnum(
  "time_tracking_entry_method",
  timeTrackingEntryMethods,
);

export const timeTrackingImportRunStatuses = [
  "running",
  "completed",
  "failed",
] as const;
export type TimeTrackingImportRunStatus =
  (typeof timeTrackingImportRunStatuses)[number];
export const timeTrackingImportRunStatusEnum = pgEnum(
  "time_tracking_import_run_status",
  timeTrackingImportRunStatuses,
);

export interface TimeTrackingImportCounters {
  inputRecords: number;
  inputSeconds: number;
  insertedRecords: number;
  insertedSeconds: number;
  updatedRecords: number;
  skippedRecords: number;
  quarantinedRecords: number;
  quarantinedSeconds: number;
  conflictRecords: number;
}

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
    cardId: bigint("cardId", { mode: "number" }).references(() => cards.id, {
      onDelete: "set null",
    }),
    workspaceMemberId: bigint("workspaceMemberId", {
      mode: "number",
    }).references(() => workspaceMembers.id, { onDelete: "set null" }),
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
        AND ${table.cardId} IS NOT NULL
        AND ${table.workspaceMemberId} IS NOT NULL
        AND ${table.timerStartedAt} IS NULL
        AND ${table.timerStoppedAt} IS NULL
        AND ${table.timerTimezone} IS NULL
        AND ${table.rawElapsedSeconds} IS NULL
      ) OR (
        ${table.entryMethod} = 'timer'
        AND ${table.cardId} IS NOT NULL
        AND ${table.workspaceMemberId} IS NOT NULL
        AND ${table.timerStartedAt} IS NOT NULL
        AND ${table.timerStoppedAt} IS NOT NULL
        AND ${table.timerTimezone} IS NOT NULL
        AND ${table.rawElapsedSeconds} IS NOT NULL
        AND ${table.timerStoppedAt} >= ${table.timerStartedAt}
      ) OR (
        ${table.entryMethod}::text = 'import'
        AND ${table.timerStartedAt} IS NULL
        AND ${table.timerStoppedAt} IS NULL
        AND ${table.timerTimezone} IS NULL
        AND ${table.rawElapsedSeconds} IS NULL
        AND ${table.createdBy} IS NULL
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

export const timeTrackingImportRuns = pgTable(
  "time_tracking_import_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    provider: varchar("provider", { length: 64 }).notNull(),
    bundleVersion: varchar("bundleVersion", { length: 128 }).notNull(),
    manifestSha256: varchar("manifestSha256", { length: 64 }).notNull(),
    status: timeTrackingImportRunStatusEnum("status")
      .notNull()
      .default("running"),
    counters: jsonb("counters").$type<TimeTrackingImportCounters>().notNull(),
    error: text("error"),
    startedAt: timestamp("startedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finishedAt", { withTimezone: true }),
  },
  (table) => [
    check(
      "time_tracking_import_runs_manifest_hash_check",
      sql`${table.manifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("time_tracking_import_runs_provider_running_idx")
      .on(table.provider)
      .where(sql`${table.status} = 'running'`),
    index("time_tracking_import_runs_provider_started_idx").on(
      table.provider,
      table.startedAt.desc(),
    ),
  ],
).enableRLS();

export const timeTrackingWorklogSources = pgTable(
  "time_tracking_worklog_sources",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    worklogId: bigint("worklogId", { mode: "number" })
      .notNull()
      .references(() => timeTrackingWorklogs.id, { onDelete: "cascade" }),
    importRunId: bigint("importRunId", { mode: "number" })
      .notNull()
      .references(() => timeTrackingImportRuns.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    externalId: varchar("externalId", { length: 255 }).notNull(),
    externalBoardId: varchar("externalBoardId", { length: 255 }).notNull(),
    externalCardId: varchar("externalCardId", { length: 255 }),
    externalMemberId: varchar("externalMemberId", { length: 255 }),
    sourceCreatedAt: timestamp("sourceCreatedAt", { withTimezone: true }),
    sourceUpdatedAt: timestamp("sourceUpdatedAt", { withTimezone: true }),
    billable: boolean("billable"),
    invoiced: boolean("invoiced"),
    sourceHash: varchar("sourceHash", { length: 64 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "time_tracking_worklog_sources_hash_check",
      sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("time_tracking_worklog_sources_worklog_idx").on(
      table.worklogId,
    ),
    uniqueIndex("time_tracking_worklog_sources_provider_external_idx").on(
      table.provider,
      table.externalId,
    ),
    index("time_tracking_worklog_sources_run_idx").on(table.importRunId),
  ],
).enableRLS();

export const timeTrackingImportQuarantine = pgTable(
  "time_tracking_import_quarantine",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    importRunId: bigint("importRunId", { mode: "number" })
      .notNull()
      .references(() => timeTrackingImportRuns.id),
    provider: varchar("provider", { length: 64 }).notNull(),
    externalId: varchar("externalId", { length: 255 }).notNull(),
    externalBoardId: varchar("externalBoardId", { length: 255 }),
    externalCardId: varchar("externalCardId", { length: 255 }),
    externalMemberId: varchar("externalMemberId", { length: 255 }),
    reason: varchar("reason", { length: 128 }).notNull(),
    durationSeconds: integer("durationSeconds"),
    normalizedRecord: jsonb("normalizedRecord")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceHash: varchar("sourceHash", { length: 64 }).notNull(),
    overrideReference: text("overrideReference"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  },
  (table) => [
    check(
      "time_tracking_import_quarantine_duration_check",
      sql`${table.durationSeconds} IS NULL OR ${table.durationSeconds} > 0`,
    ),
    check(
      "time_tracking_import_quarantine_hash_check",
      sql`${table.sourceHash} ~ '^[0-9a-f]{64}$'`,
    ),
    uniqueIndex("time_tracking_import_quarantine_provider_external_idx").on(
      table.provider,
      table.externalId,
    ),
    index("time_tracking_import_quarantine_run_idx").on(table.importRunId),
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

export const timeTrackingImportRunsRelations = relations(
  timeTrackingImportRuns,
  ({ many }) => ({
    worklogSources: many(timeTrackingWorklogSources),
    quarantineRecords: many(timeTrackingImportQuarantine),
  }),
);

export const timeTrackingWorklogSourcesRelations = relations(
  timeTrackingWorklogSources,
  ({ one }) => ({
    worklog: one(timeTrackingWorklogs, {
      fields: [timeTrackingWorklogSources.worklogId],
      references: [timeTrackingWorklogs.id],
    }),
    importRun: one(timeTrackingImportRuns, {
      fields: [timeTrackingWorklogSources.importRunId],
      references: [timeTrackingImportRuns.id],
    }),
  }),
);

export const timeTrackingImportQuarantineRelations = relations(
  timeTrackingImportQuarantine,
  ({ one }) => ({
    importRun: one(timeTrackingImportRuns, {
      fields: [timeTrackingImportQuarantine.importRunId],
      references: [timeTrackingImportRuns.id],
    }),
  }),
);
