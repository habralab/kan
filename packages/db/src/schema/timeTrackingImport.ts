import { relations, sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { timeTrackingWorklogs } from "./timeTracking";

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
    sourceCreatedAtRaw: varchar("sourceCreatedAtRaw", { length: 128 }),
    sourceUpdatedAtRaw: varchar("sourceUpdatedAtRaw", { length: 128 }),
    sourceTimestampTimezone: varchar("sourceTimestampTimezone", { length: 64 }),
    sourceCreatedByExternalMemberId: varchar(
      "sourceCreatedByExternalMemberId",
      { length: 255 },
    ),
    sourceCreatedByDisplayName: varchar("sourceCreatedByDisplayName", {
      length: 255,
    }),
    sourceUpdatedByExternalMemberId: varchar(
      "sourceUpdatedByExternalMemberId",
      { length: 255 },
    ),
    sourceUpdatedByDisplayName: varchar("sourceUpdatedByDisplayName", {
      length: 255,
    }),
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
