import type { JobHandler } from "@kan/jobs";
import { createDrizzleClient } from "@kan/db/client";
import {
  claimDelivery,
  getDueReminder,
  markDelivered,
  releaseDelivery,
} from "@kan/db/repository/cardReminder.repo";
import { sendEmail } from "@kan/email";
import { requirePostgresUrl } from "@kan/jobs";

requirePostgresUrl();
const db = createDrizzleClient();
const dueAtFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export async function closeJobHandlers() {
  await db.$client.end();
}

export const cardDueReminder: JobHandler = async (data) => {
  const { cardPublicId, expectedAt } = data;
  if (typeof cardPublicId !== "string" || typeof expectedAt !== "string")
    throw new Error("Invalid card reminder job data");
  const expectedTime = new Date(expectedAt);
  if (!Number.isFinite(expectedTime.getTime()))
    throw new Error("Invalid card reminder time");

  const now = Date.now();
  if (now < expectedTime.getTime()) throw new Error("Reminder job ran early");
  if (now - expectedTime.getTime() > 15 * 60_000) return;

  const card = await getDueReminder(db, cardPublicId);
  if (
    !card ||
    card.completed ||
    card.dueReminderAt?.getTime() !== expectedTime.getTime()
  )
    return;

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  if (!baseUrl)
    throw new Error("NEXT_PUBLIC_BASE_URL is required for card reminders");
  const cardUrl = new URL(
    `/cards/${encodeURIComponent(cardPublicId)}`,
    baseUrl,
  ).toString();

  let deliveryFailed = false;
  for (const recipient of card.recipients) {
    const current = await getDueReminder(db, cardPublicId);
    if (
      !current ||
      current.completed ||
      current.dueReminderAt?.getTime() !== expectedTime.getTime() ||
      current.dueReminderMinutes === null
    )
      return;
    if (
      !current.recipients.some((member) => member.userId === recipient.userId)
    )
      continue;

    const deliveryId = await claimDelivery(db, {
      cardId: card.id,
      userId: recipient.userId,
      reminderAt: expectedTime,
    });
    if (!deliveryId) continue;
    try {
      const dueAt = new Date(
        expectedTime.getTime() + current.dueReminderMinutes * 60_000,
      );
      await sendEmail(
        recipient.email,
        `Card due reminder: ${card.title}`,
        "DUE_REMINDER",
        {
          cardTitle: card.title,
          boardName: card.boardName,
          cardUrl,
          dueAtText: `${dueAtFormatter.format(dueAt)} UTC`,
        },
      );
      await markDelivered(db, deliveryId);
    } catch {
      await releaseDelivery(db, deliveryId);
      deliveryFailed = true;
    }
  }
  if (deliveryFailed)
    throw new Error("One or more card reminders could not be delivered");
};

interface JobHandlerRegistration {
  name: string;
  handler: JobHandler;
}

export const jobHandlers: readonly JobHandlerRegistration[] = [
  { name: "card-due-reminder", handler: cardDueReminder },
];
