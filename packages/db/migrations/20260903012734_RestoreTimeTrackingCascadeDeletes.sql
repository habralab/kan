ALTER TABLE "time_tracking_worklogs" DROP CONSTRAINT "time_tracking_worklogs_cardId_card_id_fk";
--> statement-breakpoint
ALTER TABLE "time_tracking_worklogs" DROP CONSTRAINT "time_tracking_worklogs_workspaceMemberId_workspace_members_id_fk";
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
