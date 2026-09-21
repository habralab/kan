import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";

import { searchCardsByBoardPublicId } from "./board.repo";

const boardPublicId = "board1234567";
let client: PGlite;
let db: dbClient;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as dbClient;

  await client.exec(`
    CREATE TABLE "board" (
      id bigint PRIMARY KEY,
      "publicId" varchar(12) NOT NULL,
      name varchar(255) NOT NULL,
      "deletedAt" timestamp
    );
    CREATE TABLE "list" (
      id bigint PRIMARY KEY,
      name varchar(255) NOT NULL,
      "boardId" bigint NOT NULL,
      "deletedAt" timestamp
    );
    CREATE TABLE card (
      id bigint PRIMARY KEY,
      "publicId" varchar(12) NOT NULL,
      title text NOT NULL,
      "cardNumber" integer,
      "listId" bigint NOT NULL,
      "deletedAt" timestamp
    );
    INSERT INTO "board" (id, "publicId", name) VALUES
      (1, 'board1234567', 'Active board'),
      (2, 'board7654321', 'Other board'),
      (3, 'boarddeleted', 'Deleted board');
    UPDATE "board" SET "deletedAt" = NOW() WHERE id = 3;
    INSERT INTO "list" (id, name, "boardId", "deletedAt") VALUES
      (1, 'Inbox', 1, NULL),
      (2, 'Archived list', 1, NOW()),
      (3, 'Other list', 2, NULL),
      (4, 'Deleted board list', 3, NULL);
    INSERT INTO card (id, "publicId", title, "cardNumber", "listId", "deletedAt") VALUES
      (1, 'card00000001', 'Match A', 1, 1, NULL),
      (2, 'card00000002', 'Match B', 2, 1, NULL),
      (3, 'card00000003', 'Match C', 3, 1, NULL),
      (4, 'card00000004', 'Привет, мир', 4, 1, NULL),
      (5, 'card00000005', '100% complete', 5, 1, NULL),
      (6, 'card00000006', 'foo_bar', 6, 1, NULL),
      (7, 'card00000007', E'path\\\\name', 7, 1, NULL),
      (8, 'card00000008', 'hidden deleted card', 8, 1, NOW()),
      (9, 'card00000009', 'hidden deleted list', 9, 2, NULL),
      (10, 'card00000010', 'Match other board', 10, 3, NULL),
      (11, 'card00000011', 'Match deleted board', 11, 4, NULL);
  `);
});

afterEach(async () => {
  await client.close();
});

describe("searchCardsByBoardPublicId", () => {
  it("searches literal, case-insensitive substrings within the active board", async () => {
    await expect(
      searchCardsByBoardPublicId(db, {
        boardPublicId,
        query: "привет",
        cursor: 0,
        limit: 30,
      }),
    ).resolves.toEqual({
      items: [
        {
          publicId: "card00000004",
          title: "Привет, мир",
          cardNumber: 4,
          listName: "Inbox",
          boardPublicId,
          boardName: "Active board",
        },
      ],
      hasMore: false,
    });

    await expect(
      searchCardsByBoardPublicId(db, {
        boardPublicId,
        query: "%",
        cursor: 0,
        limit: 30,
      }),
    ).resolves.toMatchObject({ items: [{ title: "100% complete" }] });

    await expect(
      searchCardsByBoardPublicId(db, {
        boardPublicId,
        query: "_",
        cursor: 0,
        limit: 30,
      }),
    ).resolves.toMatchObject({ items: [{ title: "foo_bar" }] });

    await expect(
      searchCardsByBoardPublicId(db, {
        boardPublicId,
        query: "\\",
        cursor: 0,
        limit: 30,
      }),
    ).resolves.toMatchObject({ items: [{ title: "path\\name" }] });
  });

  it("excludes cards outside the board and soft-deleted records", async () => {
    const result = await searchCardsByBoardPublicId(db, {
      boardPublicId,
      query: "hidden",
      cursor: 0,
      limit: 30,
    });

    expect(result).toEqual({ items: [], hasMore: false });
  });

  it("uses a stable offset page and reports another page", async () => {
    const firstPage = await searchCardsByBoardPublicId(db, {
      boardPublicId,
      query: "match",
      cursor: 0,
      limit: 2,
    });
    const secondPage = await searchCardsByBoardPublicId(db, {
      boardPublicId,
      query: "match",
      cursor: 2,
      limit: 2,
    });

    expect(firstPage).toMatchObject({
      items: [{ title: "Match A" }, { title: "Match B" }],
      hasMore: true,
    });
    expect(secondPage).toMatchObject({
      items: [{ title: "Match C" }],
      hasMore: false,
    });
  });
});
