import { describe, expect, it } from "vitest";

import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import { boards, cardActivities, cards, comments, lists } from "@kan/db/schema";

import { createTestDb, seedTestData } from "./test-db";

describe("card activity repository", () => {
  it("filters before stable pagination in both orders", async () => {
    const db = await createTestDb();
    const { user, workspace } = await seedTestData(db);

    const [board] = await db
      .insert(boards)
      .values({
        publicId: "board1234567",
        name: "Test board",
        slug: "test-board",
        createdBy: user.id,
        workspaceId: workspace.id,
      })
      .returning();
    const [list] = await db
      .insert(lists)
      .values({
        publicId: "list12345678",
        name: "Test list",
        index: 1,
        createdBy: user.id,
        boardId: board!.id,
      })
      .returning();
    const [card] = await db
      .insert(cards)
      .values({
        publicId: "card12345678",
        title: "Test card",
        index: 1,
        createdBy: user.id,
        listId: list!.id,
      })
      .returning();
    const [comment] = await db
      .insert(comments)
      .values({
        publicId: "comment00001",
        comment: "A comment",
        cardId: card!.id,
        createdBy: user.id,
      })
      .returning();

    const sharedTimestamp = new Date("2026-09-06T10:00:00.000Z");
    await db.insert(cardActivities).values([
      {
        publicId: "activity0001",
        type: "card.created",
        cardId: card!.id,
        createdBy: user.id,
        createdAt: sharedTimestamp,
      },
      {
        publicId: "activity0002",
        type: "card.updated.comment.added",
        cardId: card!.id,
        commentId: comment!.id,
        createdBy: user.id,
        createdAt: sharedTimestamp,
      },
      {
        publicId: "activity0003",
        type: "card.updated.title",
        cardId: card!.id,
        createdBy: user.id,
        createdAt: sharedTimestamp,
      },
      {
        publicId: "activity0004",
        type: "card.updated.description",
        cardId: card!.id,
        createdBy: user.id,
        createdAt: new Date("2026-09-06T11:00:00.000Z"),
      },
    ]);

    for (const order of ["oldest", "newest"] as const) {
      const firstPage = await cardActivityRepo.getPaginatedActivities(
        db,
        card!.id,
        { limit: 2, order, filter: "all" },
      );
      const secondPage = await cardActivityRepo.getPaginatedActivities(
        db,
        card!.id,
        {
          limit: 2,
          order,
          filter: "all",
          cursor: firstPage.nextCursor,
        },
      );
      const publicIds = [...firstPage.activities, ...secondPage.activities].map(
        ({ publicId }) => publicId,
      );

      expect(publicIds).toEqual(
        order === "oldest"
          ? ["activity0001", "activity0002", "activity0003", "activity0004"]
          : ["activity0004", "activity0003", "activity0002", "activity0001"],
      );
      expect(new Set(publicIds).size).toBe(4);
      expect(firstPage.hasMore).toBe(true);
      expect(secondPage.hasMore).toBe(false);
    }

    const commentsOnly = await cardActivityRepo.getPaginatedActivities(
      db,
      card!.id,
      { limit: 1, order: "newest", filter: "comments" },
    );
    expect(commentsOnly.activities.map(({ publicId }) => publicId)).toEqual([
      "activity0002",
    ]);
    expect(commentsOnly.hasMore).toBe(false);

    const activityFirstPage = await cardActivityRepo.getPaginatedActivities(
      db,
      card!.id,
      { limit: 2, order: "oldest", filter: "activity" },
    );
    const activitySecondPage = await cardActivityRepo.getPaginatedActivities(
      db,
      card!.id,
      {
        limit: 2,
        order: "oldest",
        filter: "activity",
        cursor: activityFirstPage.nextCursor,
      },
    );
    expect(
      [...activityFirstPage.activities, ...activitySecondPage.activities].map(
        ({ publicId }) => publicId,
      ),
    ).toEqual(["activity0001", "activity0003", "activity0004"]);
  });
});
