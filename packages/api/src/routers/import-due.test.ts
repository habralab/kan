import { afterEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as customFieldImportRepo from "@kan/db/repository/custom-field-import.repo";
import * as importRepo from "@kan/db/repository/import.repo";
import * as integrationsRepo from "@kan/db/repository/integration.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import { assertPermission } from "../utils/permissions";
import {
  decryptTrelloToken,
  isEncryptedTrelloToken,
} from "../utils/trello-token";

vi.mock("@kan/db/repository/board.repo", () => ({ create: vi.fn() }));
vi.mock("@kan/db/repository/card.repo", () => ({ bulkCreate: vi.fn() }));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));
vi.mock("@kan/db/repository/custom-field-import.repo", () => ({
  importBoardCustomFields: vi.fn(),
}));
vi.mock("@kan/db/repository/import.repo", () => ({
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@kan/db/repository/integration.repo", () => ({
  getProviderForUser: vi.fn(),
}));
vi.mock("@kan/db/repository/list.repo", () => ({ create: vi.fn() }));
vi.mock("@kan/db/repository/workspace.repo", () => ({
  getByPublicId: vi.fn(),
}));
vi.mock("../utils/permissions", () => ({ assertPermission: vi.fn() }));
vi.mock("../utils/encryption", () => ({ decryptToken: vi.fn() }));
vi.mock("../utils/trello-token", () => ({
  decryptTrelloToken: vi.fn(),
  isEncryptedTrelloToken: vi.fn(),
  encryptTrelloToken: vi.fn(),
}));
vi.mock("./integration", () => ({
  apiKeys: { trello: "test-api-key" },
  urls: { trello: "https://trello.example.test" },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Trello due date import", () => {
  it("passes exact due times and absent dates to card bulk creation", async () => {
    const db = {} as never;
    vi.mocked(integrationsRepo.getProviderForUser).mockResolvedValue({
      accessToken: "encrypted-token",
    } as never);
    vi.mocked(decryptTrelloToken).mockReturnValue("test-token");
    vi.mocked(isEncryptedTrelloToken).mockReturnValue(true);
    vi.mocked(workspaceRepo.getByPublicId).mockResolvedValue({
      id: 1,
    } as never);
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    vi.mocked(importRepo.create).mockResolvedValue({ id: 2 } as never);
    vi.mocked(importRepo.update).mockResolvedValue({ id: 2 } as never);
    vi.mocked(boardRepo.create).mockResolvedValue({ id: 3 } as never);
    vi.mocked(listRepo.create).mockResolvedValue({ id: 4 } as never);
    vi.mocked(cardRepo.bulkCreate).mockResolvedValue([
      { id: 5 },
      { id: 6 },
    ] as never);
    vi.mocked(cardActivityRepo.bulkCreate).mockResolvedValue([]);
    vi.mocked(customFieldImportRepo.importBoardCustomFields).mockResolvedValue({
      definitionsCreated: 0,
      optionsCreated: 0,
      valuesCreated: 0,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "board-1",
            name: "Board",
            labels: [],
            lists: [{ id: "list-1", name: "Todo" }],
            cards: [
              {
                id: "card-1",
                name: "Timed",
                desc: "",
                idList: "list-1",
                due: "2026-09-15T18:00:00.000Z",
                labels: [],
              },
              {
                id: "card-2",
                name: "No due date",
                desc: "",
                idList: "list-1",
                due: null,
                labels: [],
              },
            ],
            checklists: [],
          }),
          { status: 200 },
        ),
      ),
    );

    const { importRouter } = await import("./import");
    const caller = importRouter.createCaller({
      db,
      user: { id: "user-1" },
    } as never);

    await expect(
      caller.trello.importBoards({
        boardIds: ["board-1"],
        workspacePublicId: "workspace-123456",
      }),
    ).resolves.toEqual({ boardsCreated: 1 });

    expect(cardRepo.bulkCreate).toHaveBeenCalledWith(db, [
      expect.objectContaining({
        title: "Timed",
        dueDate: new Date("2026-09-15T18:00:00.000Z"),
        dueDateHasTime: true,
      }),
      expect.objectContaining({
        title: "No due date",
        dueDate: null,
        dueDateHasTime: false,
      }),
    ]);
  });
});
