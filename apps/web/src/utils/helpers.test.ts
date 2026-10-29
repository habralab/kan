import { env } from "next-runtime-env";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAvatarUrl, isPlaceholderPublicId } from "./helpers";

vi.mock("next-runtime-env", () => ({
  env: vi.fn(),
}));

const mockEnv = env as ReturnType<typeof vi.fn>;

describe("isPlaceholderPublicId", () => {
  it("identifies optimistic entity IDs", () => {
    expect(isPlaceholderPublicId("PLACEHOLDER_abc123")).toBe(true);
    expect(isPlaceholderPublicId("abc123")).toBe(false);
  });
});

describe("getAvatarUrl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string for null input", () => {
    expect(getAvatarUrl(null)).toBe("");
  });

  it("returns empty string for empty string input", () => {
    expect(getAvatarUrl("")).toBe("");
  });

  it("returns URL unchanged if already absolute http", () => {
    expect(getAvatarUrl("http://example.com/avatar.jpg")).toBe(
      "http://example.com/avatar.jpg",
    );
  });

  it("returns URL unchanged if already absolute https", () => {
    expect(getAvatarUrl("https://example.com/avatar.jpg")).toBe(
      "https://example.com/avatar.jpg",
    );
  });

  it("uses the same-origin avatar route in proxy mode", () => {
    mockEnv.mockImplementation((key: string) => {
      if (key === "NEXT_PUBLIC_STORAGE_READ_MODE") return "proxy";
      if (key === "NEXT_PUBLIC_AVATAR_BUCKET_NAME") return "avatars";
      return undefined;
    });

    expect(getAvatarUrl("user/avatar 1.png")).toBe(
      "/api/storage/read?bucket=avatars&key=user%2Favatar+1.png",
    );
    expect(
      getAvatarUrl("/api/storage/read?bucket=avatars&key=user%2Favatar.png"),
    ).toBe("/api/storage/read?bucket=avatars&key=user%2Favatar.png");
  });

  describe("path-style URLs (MinIO/LocalStack)", () => {
    it("constructs path-style URL when STORAGE_DOMAIN is not set", () => {
      mockEnv.mockImplementation((key: string) => {
        const vars: Record<string, string> = {
          NEXT_PUBLIC_STORAGE_URL: "http://s3.localtest.me:9000",
          NEXT_PUBLIC_AVATAR_BUCKET_NAME: "kan",
        };
        return vars[key];
      });

      expect(getAvatarUrl("user123/avatar.jpg")).toBe(
        "http://s3.localtest.me:9000/kan/user123/avatar.jpg",
      );
    });
  });

  describe("virtual-hosted URLs (Tigris/AWS S3)", () => {
    it("constructs virtual-hosted URL when USE_VIRTUAL_HOSTED_URLS is true and STORAGE_DOMAIN is set", () => {
      mockEnv.mockImplementation((key: string) => {
        const vars: Record<string, string> = {
          NEXT_PUBLIC_USE_VIRTUAL_HOSTED_URLS: "true",
          NEXT_PUBLIC_STORAGE_DOMAIN: "fly.storage.tigris.dev",
          NEXT_PUBLIC_AVATAR_BUCKET_NAME: "kan-avatars",
          NEXT_PUBLIC_STORAGE_URL: "https://fly.storage.tigris.dev",
        };
        return vars[key];
      });

      expect(getAvatarUrl("user123/avatar.jpg")).toBe(
        "https://kan-avatars.fly.storage.tigris.dev/user123/avatar.jpg",
      );
    });

    it("uses path-style URL when USE_VIRTUAL_HOSTED_URLS is false even if STORAGE_DOMAIN is set", () => {
      mockEnv.mockImplementation((key: string) => {
        const vars: Record<string, string> = {
          NEXT_PUBLIC_USE_VIRTUAL_HOSTED_URLS: "false",
          NEXT_PUBLIC_STORAGE_DOMAIN: "fly.storage.tigris.dev",
          NEXT_PUBLIC_AVATAR_BUCKET_NAME: "kan-avatars",
          NEXT_PUBLIC_STORAGE_URL: "https://fly.storage.tigris.dev",
        };
        return vars[key];
      });

      expect(getAvatarUrl("user123/avatar.jpg")).toBe(
        "https://fly.storage.tigris.dev/kan-avatars/user123/avatar.jpg",
      );
    });

    it("uses path-style URL when USE_VIRTUAL_HOSTED_URLS is not set even if STORAGE_DOMAIN is set", () => {
      mockEnv.mockImplementation((key: string) => {
        const vars: Record<string, string> = {
          NEXT_PUBLIC_STORAGE_DOMAIN: "fly.storage.tigris.dev",
          NEXT_PUBLIC_AVATAR_BUCKET_NAME: "kan-avatars",
          NEXT_PUBLIC_STORAGE_URL: "https://fly.storage.tigris.dev",
        };
        return vars[key];
      });

      expect(getAvatarUrl("user123/avatar.jpg")).toBe(
        "https://fly.storage.tigris.dev/kan-avatars/user123/avatar.jpg",
      );
    });
  });
});
