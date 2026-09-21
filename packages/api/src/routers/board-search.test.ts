import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";

import { assertPermission } from "../utils/permissions";
import { boardRouter } from "./board";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWorkspaceAndBoardIdByBoardPublicId: vi.fn(),
  searchCardsByBoardPublicId: vi.fn(),
}));
vi.mock("@kan/db/repository/workspace.repo", () => ({}));
vi.mock("@kan/db/repository/card.repo", () => ({}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({}));
vi.mock("@kan/db/repository/cardAttachment.repo", () => ({}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/list.repo", () => ({}));
vi.mock("@kan/db/repository/timeTracking.repo", () => ({}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("@kan/shared/constants", () => ({ colours: [] }));

const db = {} as never;
const user = { id: "user-123", email: "user@example.com", name: "User" };
const boardPublicId = "board1234567";
const getBoard = vi.mocked(boardRepo.getWorkspaceAndBoardIdByBoardPublicId);
const searchCards = vi.mocked(boardRepo.searchCardsByBoardPublicId);
const assertBoardView = vi.mocked(assertPermission);

describe("board card search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBoard.mockResolvedValue({
      id: 1,
      workspaceId: 2,
      createdBy: null,
      backgroundImageKey: null,
    });
    assertBoardView.mockResolvedValue(undefined);
  });

  it("scopes the search to the requested board and applies board:view", async () => {
    searchCards.mockResolvedValue({
      items: [
        {
          publicId: "card12345678",
          title: "Привет, search",
          cardNumber: 7,
          listName: "Inbox",
          boardPublicId,
          boardName: "Board",
        },
      ],
      hasMore: false,
    });

    const result = await boardRouter
      .createCaller({ db, user } as never)
      .searchCards({
        boardPublicId,
        query: "Привет",
      });

    expect(assertBoardView).toHaveBeenCalledWith(db, user.id, 2, "board:view");
    expect(searchCards).toHaveBeenCalledWith(db, {
      boardPublicId,
      query: "Привет",
      cursor: 0,
      limit: 30,
    });
    expect(result).toEqual({
      items: [
        {
          publicId: "card12345678",
          title: "Привет, search",
          cardNumber: 7,
          listName: "Inbox",
          boardPublicId,
          boardName: "Board",
        },
      ],
      nextCursor: null,
    });
  });

  it("returns a next offset only when the repository has another page", async () => {
    searchCards.mockResolvedValue({ items: [], hasMore: true });

    const result = await boardRouter
      .createCaller({ db, user } as never)
      .searchCards({
        boardPublicId,
        query: "none",
        cursor: 50,
        limit: 25,
      });

    expect(result).toEqual({ items: [], nextCursor: 75 });
  });

  it("does not search when board:view permission is denied", async () => {
    assertBoardView.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Forbidden" }),
    );

    await expect(
      boardRouter.createCaller({ db, user } as never).searchCards({
        boardPublicId,
        query: "search",
      }),
    ).rejects.toThrow("Forbidden");

    expect(searchCards).not.toHaveBeenCalled();
  });
});
