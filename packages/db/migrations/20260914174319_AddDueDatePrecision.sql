ALTER TABLE "card_activity" ADD COLUMN "toDueDateHasTime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "dueDateHasTime" boolean DEFAULT false NOT NULL;