ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.checklist.item.dueDate.added' BEFORE 'card.updated.checklist.item.deleted';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.checklist.item.dueDate.updated' BEFORE 'card.updated.checklist.item.deleted';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.checklist.item.dueDate.removed' BEFORE 'card.updated.checklist.item.deleted';--> statement-breakpoint
ALTER TABLE "card_checklist_item" ADD COLUMN "dueDate" timestamp;--> statement-breakpoint
ALTER TABLE "card_checklist_item" ADD COLUMN "dueDateHasTime" boolean DEFAULT false NOT NULL;