ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.checklist.item.assignee.assigned' BEFORE 'card.updated.checklist.item.deleted';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.checklist.item.assignee.unassigned' BEFORE 'card.updated.checklist.item.deleted';--> statement-breakpoint
ALTER TABLE "card_checklist_item" ADD COLUMN "assigneeId" bigint;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_checklist_item" ADD CONSTRAINT "card_checklist_item_assigneeId_workspace_members_id_fk" FOREIGN KEY ("assigneeId") REFERENCES "public"."workspace_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
