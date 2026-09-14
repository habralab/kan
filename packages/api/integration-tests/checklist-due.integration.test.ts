import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as cardRepo from "@kan/db/repository/card.repo";
import * as checklistRepo from "@kan/db/repository/checklist.repo";
import {
  boards,
  cards,
  checklists,
  lists,
  workspaceMembers,
} from "@kan/db/schema";

import { createTestDb, seedTestData } from "./test-db";
import { checklistItemResponseSchema } from "../src/schemas/common";

describe("checklist item due dates", () => {
  it("persists dates and times through item writes and card reads", async () => {
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
    const [checklist] = await db
      .insert(checklists)
      .values({
        publicId: "checklist123",
        name: "Steps",
        index: 0,
        createdBy: user.id,
        cardId: card!.id,
      })
      .returning();
    const dueDate = new Date("2026-09-15T18:00:00.000Z");

    const item = await checklistRepo.createItem(db, {
      checklistId: checklist!.id,
      title: "Prepare the route",
      createdBy: user.id,
      dueDate,
      dueDateHasTime: true,
    });
    expect(item).toMatchObject({ dueDate, dueDateHasTime: true });

    const cardWithItem = await cardRepo.getWithListAndMembersByPublicId(
      db,
      card!.publicId,
    );
    expect(cardWithItem?.checklists[0]?.items[0]).toMatchObject({
      dueDate,
      dueDateHasTime: true,
    });

    const cleared = await checklistRepo.updateItemById(db, {
      id: item!.id,
      dueDate: null,
    });
    expect(cleared).toMatchObject({ dueDate: null, dueDateHasTime: false });

    const member = await db.query.workspaceMembers.findFirst({
      where: eq(workspaceMembers.workspaceId, workspace.id),
    });
    await checklistRepo.updateItemById(db, {
      id: item!.id,
      assigneeId: member!.id,
    });
    const assignedCard = await cardRepo.getWithListAndMembersByPublicId(
      db,
      card!.publicId,
    );
    expect(assignedCard?.checklists[0]?.items[0]?.assignee).toMatchObject({
      publicId: member!.publicId,
      status: "active",
    });
    const publicItem = checklistItemResponseSchema.parse(
      assignedCard?.checklists[0]?.items[0],
    );
    expect(publicItem).not.toHaveProperty("assigneeId");

    await db
      .update(workspaceMembers)
      .set({ status: "paused" })
      .where(eq(workspaceMembers.id, member!.id));
    const historical = await cardRepo.getWithListAndMembersByPublicId(
      db,
      card!.publicId,
    );
    expect(historical?.checklists[0]?.items[0]?.assignee?.status).toBe(
      "paused",
    );
  });
});
