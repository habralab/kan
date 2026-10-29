import { env } from "next-runtime-env";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createS3Client,
  createStorageReadUrl,
  generateAvatarUrl,
  generateDownloadUrl,
  getStorageReadMode,
  signStorageRead,
} from "./s3";

vi.mock("next-runtime-env", () => ({ env: vi.fn() }));

const originalS3Region = process.env.S3_REGION;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(env).mockReset();
  if (originalS3Region === undefined) {
    delete process.env.S3_REGION;
  } else {
    process.env.S3_REGION = originalS3Region;
  }
});

describe("storage read URLs", () => {
  it("defaults to direct reads", () => {
    expect(getStorageReadMode()).toBe("direct");
  });

  it("keeps S3 presigned reads in direct mode", async () => {
    vi.stubEnv("S3_ENDPOINT", "http://127.0.0.1:9000");
    vi.stubEnv("S3_ACCESS_KEY_ID", "test-access-key");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "test-secret-key");
    vi.stubEnv("S3_FORCE_PATH_STYLE", "true");

    const url = new URL(
      await generateDownloadUrl("attachments", "card/image.png", 60),
    );
    expect(url.origin).toBe("http://127.0.0.1:9000");
    expect(url.pathname).toBe("/attachments/card/image.png");
    expect(url.searchParams.has("X-Amz-Signature")).toBe(true);
  });

  it("signs an absolute Kan URL for proxy reads", () => {
    vi.mocked(env).mockImplementation((name) => {
      if (name === "NEXT_PUBLIC_STORAGE_READ_MODE") return "proxy";
      if (name === "NEXT_PUBLIC_BASE_URL") return "https://kan.example";
      return undefined;
    });
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-with-adequate-length");

    expect(getStorageReadMode()).toBe("proxy");
    const url = new URL(createStorageReadUrl("attachments", "a/b c.png", 60));
    expect(url.origin).toBe("https://kan.example");
    expect(url.pathname).toBe("/api/storage/read");
    expect(url.searchParams.get("key")).toBe("a/b c.png");
    expect(url.searchParams.get("signature")).toBe(
      signStorageRead(
        "attachments",
        "a/b c.png",
        Number(url.searchParams.get("expires")),
      ),
    );
    expect(signStorageRead("avatars", "a/b c.png", 123)).not.toBe(
      signStorageRead("attachments", "a/b c.png", 123),
    );
  });

  it("keeps public avatar URLs stable in proxy mode", async () => {
    vi.mocked(env).mockImplementation((name) => {
      if (name === "NEXT_PUBLIC_STORAGE_READ_MODE") return "proxy";
      if (name === "NEXT_PUBLIC_BASE_URL") return "https://kan.example";
      if (name === "NEXT_PUBLIC_AVATAR_BUCKET_NAME") return "avatars";
      return undefined;
    });

    expect(await generateAvatarUrl("user/avatar.png")).toBe(
      "https://kan.example/api/storage/read?bucket=avatars&key=user%2Favatar.png",
    );
    expect(await generateAvatarUrl("https://accounts.example/avatar.png")).toBe(
      "https://accounts.example/avatar.png",
    );
  });
});

describe("createS3Client", () => {
  it("defaults to us-east-1 when S3_REGION is unset", async () => {
    delete process.env.S3_REGION;

    const client = createS3Client();

    await expect(client.config.region()).resolves.toBe("us-east-1");
    client.destroy();
  });

  it("defaults to us-east-1 when S3_REGION is empty", async () => {
    process.env.S3_REGION = "";

    const client = createS3Client();

    await expect(client.config.region()).resolves.toBe("us-east-1");
    client.destroy();
  });

  it("uses S3_REGION when it is configured", async () => {
    process.env.S3_REGION = "eu-west-1";

    const client = createS3Client();

    await expect(client.config.region()).resolves.toBe("eu-west-1");
    client.destroy();
  });

  it("does not add optional checksums to presigned browser uploads", async () => {
    const client = createS3Client();

    await expect(client.config.requestChecksumCalculation()).resolves.toBe(
      "WHEN_REQUIRED",
    );
    client.destroy();
  });
});
