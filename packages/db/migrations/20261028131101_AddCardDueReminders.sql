CREATE TABLE IF NOT EXISTS "card_reminder_delivery" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cardId" bigint NOT NULL,
	"userId" uuid NOT NULL,
	"reminderAt" timestamp with time zone NOT NULL,
	"claimUntil" timestamp with time zone,
	"sentAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "card_reminder_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "dueReminderMinutes" integer;--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "dueReminderAt" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_reminder_delivery" ADD CONSTRAINT "card_reminder_delivery_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_reminder_delivery" ADD CONSTRAINT "card_reminder_delivery_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "card_reminder_delivery_unique_idx" ON "card_reminder_delivery" USING btree ("cardId","userId","reminderAt");--> statement-breakpoint
ALTER TABLE "card" ADD CONSTRAINT "card_due_reminder_configuration_check" CHECK (("card"."dueReminderMinutes" IS NULL AND "card"."dueReminderAt" IS NULL) OR ("card"."dueReminderMinutes" >= 0 AND "card"."dueReminderAt" IS NOT NULL AND "card"."dueDate" IS NOT NULL AND "card"."dueDateHasTime"));