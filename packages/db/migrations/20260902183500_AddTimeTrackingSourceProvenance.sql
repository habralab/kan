ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceCreatedAtRaw" varchar(128);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceUpdatedAtRaw" varchar(128);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceTimestampTimezone" varchar(64);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceCreatedByExternalMemberId" varchar(255);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceCreatedByDisplayName" varchar(255);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceUpdatedByExternalMemberId" varchar(255);--> statement-breakpoint
ALTER TABLE "time_tracking_worklog_sources" ADD COLUMN "sourceUpdatedByDisplayName" varchar(255);