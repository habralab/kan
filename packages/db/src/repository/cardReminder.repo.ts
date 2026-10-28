import { and, eq, isNull, lt, or } from "drizzle-orm";

import type { dbClient } from "@kan/db/client";
import {
  boards,
  cardReminderDeliveries,
  cards,
  cardToWorkspaceMembers,
  lists,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

export async function getDueReminder(db: dbClient, cardPublicId: string) {
  const [card] = await db
    .select({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      completed: cards.completed,
      dueReminderAt: cards.dueReminderAt,
      boardName: boards.name,
      workspaceId: boards.workspaceId,
    })
    .from(cards)
    .innerJoin(lists, eq(cards.listId, lists.id))
    .innerJoin(boards, eq(lists.boardId, boards.id))
    .innerJoin(workspaces, eq(boards.workspaceId, workspaces.id))
    .where(
      and(
        eq(cards.publicId, cardPublicId),
        isNull(cards.deletedAt),
        isNull(lists.deletedAt),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
        eq(boards.isArchived, false),
      ),
    );

  if (!card) return null;

  const recipients = await db
    .select({ userId: users.id, email: users.email })
    .from(cardToWorkspaceMembers)
    .innerJoin(
      workspaceMembers,
      eq(cardToWorkspaceMembers.workspaceMemberId, workspaceMembers.id),
    )
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(
      and(
        eq(cardToWorkspaceMembers.cardId, card.id),
        eq(workspaceMembers.workspaceId, card.workspaceId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
      ),
    );

  return { ...card, recipients };
}

export async function claimDelivery(
  db: dbClient,
  input: { cardId: number; userId: string; reminderAt: Date },
) {
  const claimUntil = new Date(Date.now() + 30 * 60_000);
  const [claim] = await db
    .insert(cardReminderDeliveries)
    .values({ ...input, claimUntil })
    .onConflictDoUpdate({
      target: [
        cardReminderDeliveries.cardId,
        cardReminderDeliveries.userId,
        cardReminderDeliveries.reminderAt,
      ],
      set: { claimUntil },
      setWhere: and(
        isNull(cardReminderDeliveries.sentAt),
        or(
          isNull(cardReminderDeliveries.claimUntil),
          lt(cardReminderDeliveries.claimUntil, new Date()),
        ),
      ),
    })
    .returning({ id: cardReminderDeliveries.id });
  return claim?.id;
}

export async function markDelivered(db: dbClient, id: number) {
  await db
    .update(cardReminderDeliveries)
    .set({ sentAt: new Date(), claimUntil: null })
    .where(eq(cardReminderDeliveries.id, id));
}

export async function releaseDelivery(db: dbClient, id: number) {
  await db
    .update(cardReminderDeliveries)
    .set({ claimUntil: null })
    .where(
      and(
        eq(cardReminderDeliveries.id, id),
        isNull(cardReminderDeliveries.sentAt),
      ),
    );
}
