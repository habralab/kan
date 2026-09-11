import { DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteObjects } from "./s3";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class DeleteObjectsCommandMock extends Command {}

  return {
    CopyObjectCommand: Command,
    DeleteObjectCommand: Command,
    DeleteObjectsCommand: DeleteObjectsCommandMock,
    GetObjectCommand: Command,
    HeadObjectCommand: Command,
    PutObjectCommand: Command,
    S3Client: vi.fn(() => ({ send })),
  };
});

describe("deleteObjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    send.mockResolvedValue({});
  });

  it("does not contact storage when there are no keys", async () => {
    await expect(deleteObjects("attachments", [])).resolves.toEqual({
      deleted: [],
      errors: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("deduplicates keys and deletes them in batches of 1000", async () => {
    const keys = Array.from({ length: 2001 }, (_, index) => `object-${index}`);

    const result = await deleteObjects("attachments", [...keys, "object-0"]);

    expect(send).toHaveBeenCalledTimes(3);
    expect(
      send.mock.calls.map(([command]) => {
        expect(command).toBeInstanceOf(DeleteObjectsCommand);
        const input = (command as DeleteObjectsCommand).input;
        expect(input).toMatchObject({
          Bucket: "attachments",
          Delete: { Quiet: true },
        });
        return input.Delete?.Objects?.length;
      }),
    ).toEqual([1000, 1000, 1]);
    expect(result).toEqual({ deleted: keys, errors: [] });
  });

  it("reports response and request failures without stopping other batches", async () => {
    const keys = Array.from({ length: 2001 }, (_, index) => `object-${index}`);
    send
      .mockResolvedValueOnce({
        Errors: [
          { Key: "object-2", Code: "AccessDenied", Message: "Denied" },
          { Key: "object-3", Code: "NoSuchKey", Message: "Key not found" },
        ],
      })
      .mockRejectedValueOnce(new Error("Garage unavailable"))
      .mockResolvedValueOnce({});

    const result = await deleteObjects("attachments", keys);

    expect(result.deleted).toHaveLength(1000);
    expect(result.errors).toHaveLength(1001);
    expect(result.errors).toContainEqual({
      key: "object-2",
      code: "AccessDenied",
      message: "Denied",
    });
    expect(result.errors).toContainEqual({
      key: "object-1000",
      message: "Garage unavailable",
    });
    expect(result.deleted).toContain("object-3");
  });

  it("limits concurrent batch requests to four", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    send.mockImplementation(async () => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await Promise.resolve();
      activeRequests -= 1;
      return {};
    });

    await deleteObjects(
      "attachments",
      Array.from({ length: 5000 }, (_, index) => `object-${index}`),
    );

    expect(maxActiveRequests).toBe(4);
  });
});
