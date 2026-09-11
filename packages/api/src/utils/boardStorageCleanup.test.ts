import { describe, expect, it, vi } from "vitest";

import {
  deleteBoardStorageObjects,
  getBoardStorageObjectKeys,
} from "./boardStorageCleanup";

describe("board storage cleanup", () => {
  const boardPublicId = "board1234567";
  const backgroundImageKey = "workspace/board/background.jpg";
  const attachments = [
    { publicId: "attach123456", s3Key: "cards/photo.jpg" },
    { publicId: "attach654321", s3Key: "cards/document.pdf" },
  ];

  it("collects originals and deterministic previews without duplicate keys", () => {
    const keys = getBoardStorageObjectKeys({
      boardPublicId,
      backgroundImageKey,
      attachments: [
        ...attachments,
        { publicId: "attach123456", s3Key: "cards/photo.jpg" },
      ],
    });

    expect(keys).toHaveLength(12);
    expect(keys).toContain(backgroundImageKey);
    expect(keys).toContain("cards/photo.jpg");
    expect(keys).toContain("card-cover-previews/v1/attach123456/1280.webp");
    expect(
      keys.some((key) => key.startsWith("board-background-previews/v1/")),
    ).toBe(true);
  });

  it("maps partial batch failures to per-key settled results", async () => {
    const storage = {
      deleteObjects: vi.fn((_bucket: string, keys: readonly string[]) =>
        Promise.resolve({
          deleted: keys.filter((key) => key !== "cards/photo.jpg"),
          errors: [
            {
              key: "cards/photo.jpg",
              code: "AccessDenied",
              message: "Denied",
            },
          ],
        }),
      ),
    };

    const results = await deleteBoardStorageObjects({
      bucket: "attachments",
      boardPublicId,
      backgroundImageKey,
      attachments,
      storage,
    });

    expect(storage.deleteObjects).toHaveBeenCalledOnce();
    expect(
      results.find(({ key }) => key === "cards/photo.jpg")?.result,
    ).toMatchObject({ status: "rejected" });
    expect(
      results.find(({ key }) => key === "cards/document.pdf")?.result,
    ).toEqual({ status: "fulfilled", value: undefined });
  });

  it("skips storage when the board has no owned objects", async () => {
    const storage = { deleteObjects: vi.fn() };

    await expect(
      deleteBoardStorageObjects({
        bucket: "attachments",
        boardPublicId,
        backgroundImageKey: null,
        attachments: [],
        storage,
      }),
    ).resolves.toEqual([]);
    expect(storage.deleteObjects).not.toHaveBeenCalled();
  });

  it("turns a whole storage request failure into rejected results", async () => {
    const error = new Error("Garage unavailable");
    const storage = { deleteObjects: vi.fn().mockRejectedValue(error) };

    const results = await deleteBoardStorageObjects({
      bucket: "attachments",
      boardPublicId,
      backgroundImageKey: null,
      attachments: [{ publicId: "attach123456", s3Key: "cards/photo.jpg" }],
      storage,
    });

    expect(results).toHaveLength(4);
    expect(results.every(({ result }) => result.status === "rejected")).toBe(
      true,
    );
  });
});
