CREATE TYPE "public"."time_tracking_entry_method" AS ENUM('manual', 'timer');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_active_timers" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"userId" uuid NOT NULL,
	"workspaceMemberId" bigint NOT NULL,
	"boardId" bigint NOT NULL,
	"cardId" bigint NOT NULL,
	"startedAt" timestamp with time zone NOT NULL,
	"startTimezone" varchar(64) NOT NULL,
	"comment" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "time_tracking_active_timers_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "time_tracking_active_timers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_board_settings" (
	"boardId" bigint PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"roundingIntervalSeconds" integer DEFAULT 60 NOT NULL,
	"minimumDurationSeconds" integer DEFAULT 60 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"createdBy" uuid,
	"updatedAt" timestamp,
	"updatedBy" uuid,
	CONSTRAINT "time_tracking_board_settings_rounding_interval_check" CHECK ("time_tracking_board_settings"."roundingIntervalSeconds" BETWEEN 1 AND 3600),
	CONSTRAINT "time_tracking_board_settings_minimum_duration_check" CHECK ("time_tracking_board_settings"."minimumDurationSeconds" BETWEEN 1 AND 86400)
);
--> statement-breakpoint
ALTER TABLE "time_tracking_board_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "time_tracking_worklogs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"publicId" varchar(12) NOT NULL,
	"boardId" bigint NOT NULL,
	"cardId" bigint NOT NULL,
	"workspaceMemberId" bigint NOT NULL,
	"workDate" date NOT NULL,
	"durationSeconds" integer NOT NULL,
	"comment" text,
	"entryMethod" time_tracking_entry_method NOT NULL,
	"timerStartedAt" timestamp with time zone,
	"timerStoppedAt" timestamp with time zone,
	"timerTimezone" varchar(64),
	"rawElapsedSeconds" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"createdBy" uuid,
	"updatedAt" timestamp,
	"updatedBy" uuid,
	"deletedAt" timestamp,
	"deletedBy" uuid,
	CONSTRAINT "time_tracking_worklogs_publicId_unique" UNIQUE("publicId"),
	CONSTRAINT "time_tracking_worklogs_duration_check" CHECK ("time_tracking_worklogs"."durationSeconds" > 0),
	CONSTRAINT "time_tracking_worklogs_raw_elapsed_check" CHECK ("time_tracking_worklogs"."rawElapsedSeconds" IS NULL OR "time_tracking_worklogs"."rawElapsedSeconds" >= 0),
	CONSTRAINT "time_tracking_worklogs_work_date_check" CHECK ("time_tracking_worklogs"."workDate" BETWEEN DATE '1970-01-01' AND DATE '9999-12-31'),
	CONSTRAINT "time_tracking_worklogs_entry_method_fields_check" CHECK ((
        "time_tracking_worklogs"."entryMethod" = 'manual'
        AND "time_tracking_worklogs"."timerStartedAt" IS NULL
        AND "time_tracking_worklogs"."timerStoppedAt" IS NULL
        AND "time_tracking_worklogs"."timerTimezone" IS NULL
        AND "time_tracking_worklogs"."rawElapsedSeconds" IS NULL
      ) OR (
        "time_tracking_worklogs"."entryMethod" = 'timer'
        AND "time_tracking_worklogs"."timerStartedAt" IS NOT NULL
        AND "time_tracking_worklogs"."timerStoppedAt" IS NOT NULL
        AND "time_tracking_worklogs"."timerTimezone" IS NOT NULL
        AND "time_tracking_worklogs"."rawElapsedSeconds" IS NOT NULL
        AND "time_tracking_worklogs"."timerStoppedAt" >= "time_tracking_worklogs"."timerStartedAt"
      ))
);
--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_active_timers" ADD CONSTRAINT "time_tracking_active_timers_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_active_timers" ADD CONSTRAINT "time_tracking_active_timers_workspaceMemberId_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_active_timers" ADD CONSTRAINT "time_tracking_active_timers_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_active_timers" ADD CONSTRAINT "time_tracking_active_timers_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_board_settings" ADD CONSTRAINT "time_tracking_board_settings_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_board_settings" ADD CONSTRAINT "time_tracking_board_settings_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_board_settings" ADD CONSTRAINT "time_tracking_board_settings_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_workspaceMemberId_workspace_members_id_fk" FOREIGN KEY ("workspaceMemberId") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_updatedBy_user_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_tracking_worklogs" ADD CONSTRAINT "time_tracking_worklogs_deletedBy_user_id_fk" FOREIGN KEY ("deletedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_tracking_active_timers_user_idx" ON "time_tracking_active_timers" USING btree ("userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_active_timers_board_idx" ON "time_tracking_active_timers" USING btree ("boardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_active_timers_card_idx" ON "time_tracking_active_timers" USING btree ("cardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_worklogs_card_date_idx" ON "time_tracking_worklogs" USING btree ("cardId","workDate" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "time_tracking_worklogs"."deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_worklogs_board_date_idx" ON "time_tracking_worklogs" USING btree ("boardId","workDate" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "time_tracking_worklogs"."deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_worklogs_member_date_idx" ON "time_tracking_worklogs" USING btree ("workspaceMemberId","workDate" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "time_tracking_worklogs"."deletedAt" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_tracking_worklogs_board_card_idx" ON "time_tracking_worklogs" USING btree ("boardId","cardId") WHERE "time_tracking_worklogs"."deletedAt" IS NULL;