import { describe, expect, it, vi } from "vitest";

vi.mock("@kan/auth/server", () => ({
  initAuth: vi.fn(() => ({ api: {} })),
}));

vi.mock("@kan/db/client", () => ({
  createDrizzleClient: vi.fn(() => ({})),
}));

describe("time tracking OpenAPI", () => {
  it("publishes the time tracking routes", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-openapi-secret-123456789");
    const { openApiDocument } = await import("./openapi");
    const paths = openApiDocument.paths;
    if (!paths) throw new Error("OpenAPI document has no paths");
    const routes = [
      ["/boards/{boardPublicId}/time-tracking/settings", ["get", "put"]],
      ["/cards/{cardPublicId}/time-tracking/worklogs", ["get", "post"]],
      ["/cards/{cardPublicId}/time-tracking/summary", ["get"]],
      ["/boards/{boardPublicId}/time-tracking/card-totals", ["get"]],
      ["/cards/{cardPublicId}/time-tracking/members", ["get"]],
      ["/time-tracking/worklogs/{worklogPublicId}", ["put", "delete"]],
      ["/time-tracking/timer", ["get", "delete"]],
      ["/cards/{cardPublicId}/time-tracking/timer", ["post"]],
      ["/time-tracking/timer/stop", ["post"]],
    ] as const;

    for (const [path, methods] of routes) {
      const operations = paths[path];
      expect(operations).toBeDefined();
      for (const method of methods) expect(operations).toHaveProperty(method);
    }
  }, 10_000);
});
