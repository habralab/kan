import { Readable, Writable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { send, destroy, readMode, sign } = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  readMode: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@kan/shared/utils", () => ({
  createS3Client: () => ({ send, destroy }),
  getStorageReadMode: readMode,
  signStorageRead: sign,
}));

vi.mock("~/env", () => ({
  env: {
    NEXT_PUBLIC_AVATAR_BUCKET_NAME: "avatars",
    NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME: "attachments",
  },
}));

const handler = (await import("../pages/api/storage/read")).default;

function request(
  query: Record<string, string>,
  headers: Record<string, string> = {},
) {
  return { method: "GET", query, headers } as unknown as NextApiRequest;
}

function response() {
  const chunks: Buffer[] = [];
  const headers = new Map<string, string>();
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk);
      callback();
    },
  });
  const res = Object.assign(stream, {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
  }) as unknown as NextApiResponse;
  return { res, chunks, headers };
}

describe("GET /api/storage/read", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readMode.mockReturnValue("proxy");
    sign.mockReturnValue("a".repeat(64));
  });

  it("rejects unsigned attachments and tampered capabilities before S3", async () => {
    const unsigned = response();
    await handler(
      request({ bucket: "attachments", key: "card/file" }),
      unsigned.res,
    );
    expect(unsigned.res.statusCode).toBe(403);

    const tampered = response();
    await handler(
      request({
        bucket: "attachments",
        key: "card/other-file",
        expires: String(Math.floor(Date.now() / 1000) + 60),
        signature: "b".repeat(64),
      }),
      tampered.res,
    );
    expect(tampered.res.statusCode).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects expired links and buckets outside Kan storage", async () => {
    const expired = response();
    await handler(
      request({
        bucket: "attachments",
        key: "card/file",
        expires: String(Math.floor(Date.now() / 1000) - 1),
        signature: "a".repeat(64),
      }),
      expired.res,
    );
    expect(expired.res.statusCode).toBe(403);

    const unrelatedBucket = response();
    await handler(
      request({ bucket: "backups", key: "private.sql" }),
      unrelatedBucket.res,
    );
    expect(unrelatedBucket.res.statusCode).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("streams authorized objects without exposing the S3 endpoint", async () => {
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from("image bytes")]),
      ContentType: "image/png",
      ContentLength: 11,
    });
    const { res, chunks, headers } = response();
    await handler(
      request({
        bucket: "attachments",
        key: "card/file.png",
        expires: String(Math.floor(Date.now() / 1000) + 60),
        signature: "a".repeat(64),
      }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(Buffer.concat(chunks).toString()).toBe("image bytes");
    expect(headers.get("content-security-policy")).toBe("sandbox");
    expect(headers.get("content-disposition")).toBe("inline");
    expect(destroy).toHaveBeenCalled();
  });

  it("passes a byte range to S3 and returns a partial response", async () => {
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from("part")]),
      ContentType: "application/octet-stream",
      ContentRange: "bytes 0-3/100",
      ContentLength: 4,
    });
    const { res, chunks, headers } = response();
    const query = {
      bucket: "attachments",
      key: "card/file.bin",
      expires: String(Math.floor(Date.now() / 1000) + 60),
      signature: "a".repeat(64),
    };
    await handler(request(query, { range: "bytes=0-3" }), res);
    expect(res.statusCode).toBe(206);
    expect(headers.get("content-range")).toBe("bytes 0-3/100");
    expect(Buffer.concat(chunks).toString()).toBe("part");
    expect(send.mock.calls[0]?.[0].input.Range).toBe("bytes=0-3");

    send.mockClear();
    const invalid = response();
    await handler(request(query, { range: "bytes=0-3,5-8" }), invalid.res);
    expect(invalid.res.statusCode).toBe(416);
    expect(send).not.toHaveBeenCalled();
  });

  it("serves public avatar keys but disables the route in direct mode", async () => {
    send.mockResolvedValue({
      Body: Readable.from([Buffer.from("avatar")]),
      ContentType: "image/png",
    });
    const avatar = response();
    await handler(
      request({ bucket: "avatars", key: "user/avatar.png" }),
      avatar.res,
    );
    expect(avatar.res.statusCode).toBe(200);
    expect(Buffer.concat(avatar.chunks).toString()).toBe("avatar");

    readMode.mockReturnValue("direct");
    const direct = response();
    await handler(
      request({ bucket: "avatars", key: "user/avatar.png" }),
      direct.res,
    );
    expect(direct.res.statusCode).toBe(404);
  });
});
