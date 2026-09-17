import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import { boards, cardActivities, cards, lists } from "@kan/db/schema";

import { createTestDb, seedTestData } from "./test-db";

const createCard = async () => {
  const db = await createTestDb();
  const { user, workspace } = await seedTestData(db);

  const [board] = await db
    .insert(boards)
    .values({
      publicId: "board1234567",
      name: "Board",
      slug: "board",
      createdBy: user.id,
      workspaceId: workspace.id,
    })
    .returning();

  const [list] = await db
    .insert(lists)
    .values({
      publicId: "list12345678",
      name: "To do",
      index: 0,
      createdBy: user.id,
      boardId: board!.id,
    })
    .returning();

  const [card] = await db
    .insert(cards)
    .values({
      publicId: "card12345678",
      title: "Card",
      index: 0,
      createdBy: user.id,
      listId: list!.id,
    })
    .returning();

  return { db, user, workspace, board: board!, list: list!, card: card! };
};

describe("card completion repository", () => {
  it("defaults new cards to incomplete and persists completion changes", async () => {
    const { db, card } = await createCard();

    expect(card.completed).toBe(false);

    const updated = await cardRepo.update(
      db,
      { completed: true },
      { cardPublicId: card.publicId },
    );

    expect(updated?.completed).toBe(true);
    const persisted = await db.query.cards.findFirst({
      where: eq(cards.publicId, card.publicId),
    });
    expect(persisted?.completed).toBe(true);
  });

  it("does not update a soft-deleted card", async () => {
    const { db, card } = await createCard();

    await db
      .update(cards)
      .set({ deletedAt: new Date() })
      .where(eq(cards.id, card.id));

    const updated = await cardRepo.update(
      db,
      { completed: true },
      { cardPublicId: card.publicId },
    );

    expect(updated).toBeUndefined();
  });

  it("filters board cards by completion state", async () => {
    const { db, user, board, list, card } = await createCard();

    await db
      .update(cards)
      .set({ completed: true })
      .where(eq(cards.id, card.id));
    await db.insert(cards).values({
      publicId: "card22345678",
      title: "Incomplete card",
      index: 1,
      createdBy: user.id,
      listId: list.id,
    });

    const getFilteredBoard = (completed: boolean) =>
      boardRepo.getByPublicId(db, board.publicId, user.id, {
        members: [],
        labels: [],
        lists: [],
        dueDate: [],
        customFields: [],
        completed,
        type: "regular",
      });

    const completedBoard = await getFilteredBoard(true);
    const incompleteBoard = await getFilteredBoard(false);

    expect(completedBoard?.lists.flatMap((item) => item.cards)).toMatchObject([
      { publicId: card.publicId, completed: true },
    ]);
    expect(incompleteBoard?.lists.flatMap((item) => item.cards)).toMatchObject([
      { publicId: "card22345678", completed: false },
    ]);
  });

  it("persists imported due dates and completion state", async () => {
    const { db, user, workspace, list } = await createCard();
    const dueDate = new Date("2026-01-15T12:00:00.000Z");

    await cardRepo.bulkCreate(db, [
      {
        publicId: "card32345678",
        title: "Imported card",
        description: null,
        createdBy: user.id,
        listId: list.id,
        workspaceId: workspace.id,
        index: 1,
        dueDate,
        completed: true,
      },
    ]);

    const importedCard = await db.query.cards.findFirst({
      where: eq(cards.publicId, "card32345678"),
    });

    expect(importedCard).toMatchObject({ dueDate, completed: true });
  });

  it("advances a recurring occurrence once for a stale completion retry", async () => {
    const { db, user, card } = await createCard();
    const dueDate = new Date("2026-09-16T18:00:00.000Z");

    await db
      .update(cards)
      .set({
        dueDate,
        recurrenceRule: "weekly",
        recurrenceTimezone: "UTC",
        recurrenceAnchorDate: dueDate,
      })
      .where(eq(cards.id, card.id));

    const input = {
      cardPublicId: card.publicId,
      expectedDueDate: dueDate,
      createdBy: user.id,
    };
    const first = await cardRepo.completeRecurringOccurrence(db, input);
    const retry = await cardRepo.completeRecurringOccurrence(db, input);

    expect(first?.advanced).toBe(true);
    expect(first?.card).toMatchObject({
      completed: false,
      dueDate: new Date("2026-09-23T18:00:00.000Z"),
    });
    expect(retry?.advanced).toBe(false);

    const recurrenceActivities = await db.query.cardActivities.findMany({
      where: eq(cardActivities.type, "card.updated.recurrence.advanced"),
    });
    expect(recurrenceActivities).toHaveLength(1);
  });
});
