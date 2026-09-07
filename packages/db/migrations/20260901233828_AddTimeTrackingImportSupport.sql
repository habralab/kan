CREATE TYPE "public"."time_tracking_import_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
ALTER TYPE "public"."time_tracking_entry_method" ADD VALUE 'import';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_import_quarantine" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"importRunId" bigint NOT NULL,
	"provider" varchar(64) NOT NULL,
	"externalId" varchar(255) NOT NULL,
	"externalBoardId" varchar(255),
	"externalCardId" varchar(255),
	"externalMemberId" varchar(255),
	"reason" varchar(128) NOT NULL,
	"durationSeconds" integer,
	"normalizedRecord" jsonb NOT NULL,
	"sourceHash" varchar(64) NOT NULL,
	"overrideReference" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvedAt" timestamp with time zone,
	CONSTRAINT "time_tracking_import_quarantine_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "time_tracking_import_quarantine_duration_check" CHECK ("time_tracking_import_quarantine"."durationSeconds" IS NULL OR "time_tracking_import_quarantine"."durationSeconds" > 0),
	CONSTRAINT "time_tracking_import_quarantine_hash_check" CHECK ("time_tracking_import_quarantine"."sourceHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "time_tracking_import_quarantine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_import_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"bundleVersion" varchar(128) NOT NULL,
	"manifestSha256" varchar(64) NOT NULL,
	"status" time_tracking_import_run_status DEFAULT 'running' NOT NULL,
	"counters" jsonb NOT NULL,
	"error" text,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	CONSTRAINT "time_tracking_import_runs_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "time_tracking_import_runs_manifest_hash_check" CHECK ("time_tracking_import_runs"."manifestSha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "time_tracking_import_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_worklog_sources" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"worklogId" bigint NOT NULL,
	"importRunId" bigint NOT NULL,
	"provider" varchar(64) NOT NULL,
	"externalId" varchar(255) NOT NULL,
	"externalBoardId" varchar(255) NOT NULL,
	"externalCardId" varchar(255),
	"externalMemberId" varchar(255),
	"sourceCreatedAt" timestamp with time zone,
	"sourceUpdatedAt" timestamp with time zone,
	"billable" boolean,
	"invoiced" boolean,
	"sourceHash" varchar(64) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_tracking_worklog_sources_hash_check" CHECK ("time_tracking_worklog_sources"."sourceHash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" DROP CONSTRAINT "time_tracking_worklogs_entry_method_fields_check";--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" DROP CONSTRAINT "time_tracking_worklogs_cardId_card_id_fk";
--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" DROP CONSTRAINT "time_tracking_worklogs_workspaceMemberId_workspace_members_id_fk";
--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" ALTER COLUMN "cardId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" ALTER COLUMN "workspaceMemberId" DROP NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_import_quarantine" ADD CONSTRAINT "time_tracking_import_quarantine_importRunId_time_tracking_import_runs_id_fk" FOREIGN KEY ("importRunId") REFERENCES "public"."time_tracking_import_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklog_sources" ADD CONSTRAINT "time_tracking_worklog_sources_worklogId_time_tracking_worklogs_id_fk" FOREIGN KEY ("worklogId") REFERENCES "public"."time_tracking_worklogs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklog_sources" ADD CONSTRAINT "time_tracking_worklog_sources_importRunId_time_tracking_import_runs_id_fk" FOREIGN KEY ("importRunId") REFERENCES "public"."time_tracking_import_runs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_tracking_import_quarantine_provider_external_idx" ON "time_tracking_import_quarantine" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_import_quarantine_run_idx" ON "time_tracking_import_quarantine" USING btree ("importRunId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_tracking_import_runs_provider_running_idx" ON "time_tracking_import_runs" USING btree ("provider") WHERE "time_tracking_import_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_import_runs_provider_started_idx" ON "time_tracking_import_runs" USING btree ("provider","startedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_tracking_worklog_sources_worklog_idx" ON "time_tracking_worklog_sources" USING btree ("worklogId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_tracking_worklog_sources_provider_external_idx" ON "time_tracking_worklog_sources" USING btree ("provider","externalId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_worklog_sources_run_idx" ON "time_tracking_worklog_sources" USING btree ("importRunId");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_workspaceMemberId_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_entry_method_fields_check" CHECK ((
        "time_tracking_worklogs"."entryMethod" = 'manual'
        AND "time_tracking_worklogs"."cardId" IS NOT NULL
        AND "time_tracking_worklogs"."workspaceMemberId" IS NOT NULL
        AND "time_tracking_worklogs"."timerStartedAt" IS NULL
        AND "time_tracking_worklogs"."timerStoppedAt" IS NULL
        AND "time_tracking_worklogs"."timerTimezone" IS NULL
        AND "time_tracking_worklogs"."rawElapsedSeconds" IS NULL
      ) OR (
        "time_tracking_worklogs"."entryMethod" = 'timer'
        AND "time_tracking_worklogs"."cardId" IS NOT NULL
        AND "time_tracking_worklogs"."workspaceMemberId" IS NOT NULL
        AND "time_tracking_worklogs"."timerStartedAt" IS NOT NULL
        AND "time_tracking_worklogs"."timerStoppedAt" IS NOT NULL
        AND "time_tracking_worklogs"."timerTimezone" IS NOT NULL
        AND "time_tracking_worklogs"."rawElapsedSeconds" IS NOT NULL
        AND "time_tracking_worklogs"."timerStoppedAt" >= "time_tracking_worklogs"."timerStartedAt"
      ) OR (
        "time_tracking_worklogs"."entryMethod"::text = 'import'
        AND "time_tracking_worklogs"."timerStartedAt" IS NULL
        AND "time_tracking_worklogs"."timerStoppedAt" IS NULL
        AND "time_tracking_worklogs"."timerTimezone" IS NULL
        AND "time_tracking_worklogs"."rawElapsedSeconds" IS NULL
        AND "time_tracking_worklogs"."createdBy" IS NULL
      ));