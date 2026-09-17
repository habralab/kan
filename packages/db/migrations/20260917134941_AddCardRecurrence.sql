CREATE TYPE "public"."card_recurrence_rule" AS ENUM('daily', 'weekdays', 'weekly', 'monthly');--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.recurrence.updated' BEFORE 'card.updated.cover';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.recurrence.advanced' BEFORE 'card.updated.cover';--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "recurrenceRule" "card_recurrence_rule";--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "recurrenceTimezone" varchar(255);--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "recurrenceAnchorDate" timestamp;--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_recurrence_configuration_check" CHECK (("card"."recurrenceRule" IS NULL AND "card"."recurrenceTimezone" IS NULL AND "card"."recurrenceAnchorDate" IS NULL) OR ("card"."recurrenceRule" IS NOT NULL AND "card"."dueDate" IS NOT NULL AND "card"."recurrenceTimezone" IS NOT NULL AND "card"."recurrenceAnchorDate" IS NOT NULL));