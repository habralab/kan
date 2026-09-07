import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createNextApiContext } from "@kan/api/trpc";
import { assertPermission } from "@kan/api/utils/permissions";
import * as timeTrackingRepo from "@kan/db/repository/timeTracking.repo";

import handler from "../pages/api/time-tracking/export";

vi.mock("@kan/api/trpc", () => ({ createNextApiContext: vi.fn() }));
vi.mock("@kan/api/utils/apiLogging", () => ({
  withApiLogging: <T>(handler: T) => handler,
}));
vi.mock("@kan/api/utils/permissions", () => ({
  assertPermission: vi.fn(),
}));
vi.mock("@kan/api/utils/rateLimit", () => ({
  withRateLimit: <T>(_options: unknown, handler: T) => handler,
}));
vi.mock("@kan/db/repository/timeTracking.repo", () => ({
  getActiveWorkspaceMemberForUser: vi.fn(),
  getBoardSettings: vi.fn(),
  getBoardWorklogGroups: vi.fn(),
  listBoardWorklogs: vi.fn(),
}));
vi.mock("~/server/timeTrackingCsv", () => import("./timeTrackingCsv"));

const mockCreateNextApiContext = vi.mocked(createNextApiContext);
const mockAssertPermission = vi.mocked(assertPermission);
const mockRepo = vi.mocked(timeTrackingRepo);

const board = {
  boardId: 10,
  boardPublicId: "board1234567",
  boardName: "Reporting",
  workspaceId: 20,
};

const createRequest = (query: Record<string, string | string[]>) =>
  ({
    method: "GET",
    query,
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
  }) as never;

const createResponse = () => {
  const response = new EventEmitter() as EventEmitter & {
    statusCode: number;
    headersSent: boolean;
    body?: unknown;
    chunks: string[];
    headers: Map<string, string>;
    ended: boolean;
    destroyedWith?: Error;
    status: (statusCode: number) => typeof response;
    json: (body: unknown) => typeof response;
    setHeader: (name: string, value: string) => typeof response;
    flushHeaders: () => void;
    write: (chunk: string) => boolean;
    end: () => void;
    destroy: (error?: Error) => void;
  };

  response.statusCode = 200;
  response.headersSent = false;
  response.chunks = [];
  response.headers = new Map();
  response.ended = false;
  response.status = (statusCode) => {
    response.statusCode = statusCode;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    response.headersSent = true;
    response.ended = true;
    return response;
  };
  response.setHeader = (name, value) => {
    response.headers.set(name.toLowerCase(), value);
    return response;
  };
  response.flushHeaders = () => {
    response.headersSent = true;
  };
  response.write = (chunk) => {
    response.chunks.push(chunk);
    return true;
  };
  response.end = () => {
    response.ended = true;
  };
  response.destroy = (error) => {
    response.destroyedWith = error;
  };

  return response;
};

const validQuery = {
  boardPublicId: board.boardPublicId,
  dateFrom: "2026-09-01",
  dateTo: "2026-09-30",
  profile: "entries",
};

describe("time tracking export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateNextApiContext.mockResolvedValue({
      user: { id: "00000000-0000-0000-0000-000000000001" },
      db: {},
    } as never);
    mockAssertPermission.mockResolvedValue(undefined);
    mockRepo.getBoardSettings.mockResolvedValue(board as never);
    mockRepo.getActiveWorkspaceMemberForUser.mockResolvedValue({
      id: 30,
      publicId: "member123456",
    });
    mockRepo.listBoardWorklogs.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
  });

  it("requires an authenticated user", async () => {
    mockCreateNextApiContext.mockResolvedValue({ user: null, db: {} } as never);
    const response = createResponse();

    await handler(createRequest(validQuery), response as never);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
    expect(mockRepo.getBoardSettings).not.toHaveBeenCalled();
  });

  it("rejects invalid filters before running an export query", async () => {
    const response = createResponse();

    await handler(
      createRequest({ ...validQuery, memberPublicIds: ["too-short"] }),
      response as never,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Invalid filter identifier" });
    expect(mockRepo.getBoardSettings).not.toHaveBeenCalled();
  });

  it("rejects a partial export date range", async () => {
    const response = createResponse();

    await handler(
      createRequest({
        boardPublicId: board.boardPublicId,
        dateFrom: "2026-09-01",
        profile: "entries",
      }),
      response as never,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ error: "Invalid export parameters" });
    expect(mockRepo.getBoardSettings).not.toHaveBeenCalled();
  });

  it("does not export without board and worklog view permissions", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("denied"));
    const response = createResponse();

    await handler(createRequest(validQuery), response as never);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "Permission denied" });
    expect(mockRepo.listBoardWorklogs).not.toHaveBeenCalled();
  });

  it("streams a private entries CSV and neutralizes spreadsheet formulas", async () => {
    mockRepo.listBoardWorklogs.mockResolvedValue({
      items: [
        {
          publicId: "worklog12345",
          workDate: "2026-09-02",
          durationSeconds: 3600,
          comment: '=HYPERLINK("https://example.com")',
          entryMethod: "manual",
          timerStartedAt: null,
          timerStoppedAt: null,
          timerTimezone: null,
          rawElapsedSeconds: null,
          createdAt: new Date("2026-09-02T10:00:00.000Z"),
          updatedAt: null,
          workspaceMember: {
            publicId: "member123456",
            email: "member@example.com",
            user: { name: null, email: "member@example.com" },
            workspace: { showEmailsToMembers: false },
          },
          card: {
            publicId: "card12345678",
            title: "Tracked card",
            cardNumber: 7,
            list: { publicId: "list12345678", name: "Done" },
            labels: [],
          },
          createdByUser: { name: "Member" },
          updatedByUser: null,
        },
      ],
      nextCursor: null,
    } as never);
    const response = createResponse();

    await handler(createRequest(validQuery), response as never);

    const csv = response.chunks.join("");
    expect(response.statusCode).toBe(200);
    expect(response.ended).toBe(true);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(csv).toContain('"Date","Duration"');
    expect(csv).toContain("anonymous_member123456");
    expect(csv).not.toContain("member@example.com");
    expect(csv).toContain(`"'=HYPERLINK(""https://example.com"")"`);
  });

  it("streams an all-time export without date filters", async () => {
    const response = createResponse();

    await handler(
      createRequest({
        boardPublicId: board.boardPublicId,
        profile: "entries",
      }),
      response as never,
    );

    const filters = mockRepo.listBoardWorklogs.mock.calls[0]?.[1].filters;
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "all-time-entries.csv",
    );
    expect(filters).not.toHaveProperty("dateFrom");
    expect(filters).not.toHaveProperty("dateTo");
  });

  it("destroys a started stream and forwards export errors to logging", async () => {
    const error = new Error("export failed");
    mockRepo.listBoardWorklogs.mockRejectedValue(error);
    const response = createResponse();

    await expect(
      handler(createRequest(validQuery), response as never),
    ).rejects.toBe(error);

    expect(response.destroyedWith).toBe(error);
    expect(response.ended).toBe(false);
  });

  it("keeps unresolved import references explicit in the entries CSV", async () => {
    mockRepo.listBoardWorklogs.mockResolvedValue({
      items: [
        {
          publicId: "worklog12345",
          workDate: "2026-09-02",
          durationSeconds: 3600,
          comment: null,
          entryMethod: "import",
          timerStartedAt: null,
          timerStoppedAt: null,
          timerTimezone: null,
          rawElapsedSeconds: null,
          createdAt: new Date("2026-09-02T10:00:00.000Z"),
          updatedAt: null,
          workspaceMember: null,
          card: null,
          createdByUser: null,
          updatedByUser: null,
        },
      ],
      nextCursor: null,
    } as never);
    const response = createResponse();

    await handler(createRequest(validQuery), response as never);

    const csv = response.chunks.join("");
    expect(response.statusCode).toBe(200);
    expect(csv).toContain("Unavailable member");
    expect(csv).toContain("Unavailable card");
    expect(csv).not.toContain("Deleted card");
  });
});
