import { deleteObjects } from "@kan/shared/utils";

import { getBoardBackgroundPreviewKeys } from "./boardBackgroundPreview";
import { getCardCoverPreviewKeys } from "./cardCoverPreview";

export interface BoardStorageAttachment {
  publicId: string;
  s3Key: string;
}

export interface BoardStorageCleanupStorage {
  deleteObjects: (
    bucket: string,
    keys: readonly string[],
  ) => Promise<{
    deleted: string[];
    errors: { key: string; code?: string; message?: string }[];
  }>;
}

const createStorage = (): BoardStorageCleanupStorage => ({ deleteObjects });

export const getBoardStorageObjectKeys = (args: {
  boardPublicId: string;
  backgroundImageKey: string | null;
  attachments: BoardStorageAttachment[];
}) => {
  const keys = new Set<string>();

  if (args.backgroundImageKey) {
    keys.add(args.backgroundImageKey);
    getBoardBackgroundPreviewKeys(
      args.boardPublicId,
      args.backgroundImageKey,
    ).forEach(({ key }) => keys.add(key));
  }

  args.attachments.forEach((attachment) => {
    keys.add(attachment.s3Key);
    getCardCoverPreviewKeys(attachment.publicId).forEach(({ key }) =>
      keys.add(key),
    );
  });

  return [...keys];
};

export const deleteBoardStorageObjects = async (args: {
  bucket: string;
  boardPublicId: string;
  backgroundImageKey: string | null;
  attachments: BoardStorageAttachment[];
  storage?: BoardStorageCleanupStorage;
}) => {
  const storage = args.storage ?? createStorage();
  const keys = getBoardStorageObjectKeys(args);
  if (keys.length === 0) return [];

  let result: Awaited<ReturnType<BoardStorageCleanupStorage["deleteObjects"]>>;
  try {
    result = await storage.deleteObjects(args.bucket, keys);
  } catch (error) {
    return keys.map((key) => ({
      key,
      result: { status: "rejected", reason: error } as const,
    }));
  }
  const errorsByKey = new Map(
    result.errors.map((error) => [error.key, error] as const),
  );

  return keys.map((key) => {
    const error = errorsByKey.get(key);
    return {
      key,
      result: error
        ? ({
            status: "rejected",
            reason: new Error(error.message ?? error.code ?? "Delete failed"),
          } as const)
        : ({ status: "fulfilled", value: undefined } as const),
    };
  });
};
