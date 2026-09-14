ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.startDate.added' BEFORE 'card.updated.cover';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.startDate.updated' BEFORE 'card.updated.cover';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.startDate.removed' BEFORE 'card.updated.cover';--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "fromStartDate" timestamp;--> statement-breakpoint
ALTER TABLE "card_activity" ADD COLUMN "toStartDate" timestamp;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "startDate" timestamp;