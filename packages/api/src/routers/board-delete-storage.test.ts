import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as activityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardAttachmentRepo from "@kan/db/repository/cardAttachment.repo";
import * as listRepo from "@kan/db/repository/list.repo";

import { deleteBoardStorageObjects } from "../utils/boardStorageCleanup";
import { assertCanDelete } from "../utils/permissions";
import { boardRouter } from "./board";

vi.mock("@kan/db/repository/board.repo", () => ({
  getWithListIdsByPublicId: vi.fn(),
  softDelete: vi.fn(),
}));
vi.mock("@kan/db/repository/card.repo", () => ({
  softDeleteAllByListIds: vi.fn(),
}));
vi.mock("@kan/db/repository/cardActivity.repo", () => ({
  bulkCreate: vi.fn(),
}));
vi.mock("@kan/db/repository/cardAttachment.repo", () => ({
  getStorageObjectsByBoardId: vi.fn(),
}));
vi.mock("@kan/db/repository/list.repo", () => ({
  softDeleteAllByBoardId: vi.fn(),
}));
vi.mock("@kan/db/repository/label.repo", () => ({}));
vi.mock("@kan/db/repository/timeTracking.repo", () => ({}));
vi.mock("@kan/db/repository/workspace.repo", () => ({}));
vi.mock("../utils/permissions", () => ({
  assertCanDelete: vi.fn(),
  assertCanEdit: vi.fn(),
  assertPermission: vi.fn(),
}));
vi.mock("../utils/boardStorageCleanup", () => ({
  deleteBoardStorageObjects: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../utils/boardBackgroundPreview", () => ({
  cloneBoardBackgroundObjects: vi.fn(),
  deleteBoardBackgroundObjects: vi.fn(() => Promise.resolve([])),
}));
vi.mock("@kan/shared/utils", () => ({
  convertDueDateFiltersToRanges: vi.fn(),
  generateDownloadUrl: vi.fn(),
  generateSlug: vi.fn(),
  generateUID: vi.fn(),
  workspacePlans: ["free", "team", "pro", "enterprise"],
}));
vi.mock("@kan/shared/constants", () => ({ colours: [] }));

const getBoard = vi.mocked(boardRepo.getWithListIdsByPublicId);
const getStorageObjects = vi.mocked(
  cardAttachmentRepo.getStorageObjectsByBoardId,
);
const softDeleteBoard = vi.mocked(boardRepo.softDelete);
const softDeleteLists = vi.mocked(listRepo.softDeleteAllByBoardId);
const softDeleteCards = vi.mocked(cardRepo.softDeleteAllByListIds);
const createActivities = vi.mocked(activityRepo.bulkCreate);
const cleanupStorage = vi.mocked(deleteBoardStorageObjects);
const checkDeletePermission = vi.mocked(assertCanDelete);

describe("board.delete storage cleanup", () => {
  const db = {} as never;
  const user = { id: "user-123", name: "Test", email: "test@example.com" };
  const boardPublicId = "board1234567";
  const board = {
    id: 1,
    publicId: boardPublicId,
    workspaceId: 2,
    createdBy: user.id,
    backgroundImageKey: "workspace/board/background.jpg",
    lists: [{ id: 3 }],
  };
  const attachments = [{ publicId: "attach123456", s3Key: "cards/photo.jpg" }];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME", "attachments");
    getBoard.mockResolvedValue(board);
    getStorageObjects.mockResolvedValue(attachments);
    checkDeletePermission.mockResolvedValue(undefined);
    softDeleteBoard.mockResolvedValue({ publicId: boardPublicId } as never);
    softDeleteLists.mockResolvedValue([{ id: 3 }] as never);
    softDeleteCards.mockResolvedValue([{ id: 4 }] as never);
    createActivities.mockResolvedValue([] as never);
    cleanupStorage.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("captures owned objects before DB deletion and cleans them after it", async () => {
    await expect(
      boardRouter.createCaller({ db, user } as never).delete({ boardPublicId }),
    ).resolves.toEqual({ success: true });

    expect(getStorageObjects).toHaveBeenCalledWith(db, board.id);
    expect(getStorageObjects.mock.invocationCallOrder[0] ?? 0).toBeLessThan(
      softDeleteBoard.mock.invocationCallOrder[0] ?? 0,
    );
    expect(cleanupStorage.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(
      createActivities.mock.invocationCallOrder[0] ?? 0,
    );
    expect(cleanupStorage).toHaveBeenCalledWith({
      bucket: "attachments",
      boardPublicId,
      backgroundImageKey: board.backgroundImageKey,
      attachments,
    });
  });

  it("does not remove objects when the database deletion fails", async () => {
    softDeleteCards.mockRejectedValue(new Error("Database unavailable"));

    await expect(
      boardRouter.createCaller({ db, user } as never).delete({ boardPublicId }),
    ).rejects.toThrow("Database unavailable");
    expect(cleanupStorage).not.toHaveBeenCalled();
  });

  it("does not contact storage when the attachments bucket is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME", "");

    await boardRouter
      .createCaller({ db, user } as never)
      .delete({ boardPublicId });

    expect(getStorageObjects).not.toHaveBeenCalled();
    expect(cleanupStorage).not.toHaveBeenCalled();
  });
});
