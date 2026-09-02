import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatTimerDuration,
  getTimeTrackingPeriodRange,
  parseDurationToSeconds,
} from "./timeTracking";

describe("getTimeTrackingPeriodRange", () => {
  const now = new Date(2026, 8, 2, 15, 30);

  it.each([
    ["all", undefined],
    ["today", { dateFrom: "2026-09-02", dateTo: "2026-09-02" }],
    ["yesterday", { dateFrom: "2026-09-01", dateTo: "2026-09-01" }],
    ["this-week", { dateFrom: "2026-08-31", dateTo: "2026-09-06" }],
    ["last-week", { dateFrom: "2026-08-24", dateTo: "2026-08-30" }],
    ["last-14-days", { dateFrom: "2026-08-20", dateTo: "2026-09-02" }],
    ["this-month", { dateFrom: "2026-09-01", dateTo: "2026-09-30" }],
    ["last-month", { dateFrom: "2026-08-01", dateTo: "2026-08-31" }],
    ["this-quarter", { dateFrom: "2026-07-01", dateTo: "2026-09-30" }],
    ["last-quarter", { dateFrom: "2026-04-01", dateTo: "2026-06-30" }],
    ["this-year", { dateFrom: "2026-01-01", dateTo: "2026-12-31" }],
    ["last-year", { dateFrom: "2025-01-01", dateTo: "2025-12-31" }],
  ] as const)(
    "resolves %s using local calendar boundaries",
    (period, range) => {
      expect(getTimeTrackingPeriodRange(period, now)).toEqual(range);
    },
  );

  it("handles previous periods across a year boundary", () => {
    const january = new Date(2026, 0, 5);

    expect(getTimeTrackingPeriodRange("last-month", january)).toEqual({
      dateFrom: "2025-12-01",
      dateTo: "2025-12-31",
    });
    expect(getTimeTrackingPeriodRange("last-quarter", january)).toEqual({
      dateFrom: "2025-10-01",
      dateTo: "2025-12-31",
    });
  });
});

describe("parseDurationToSeconds", () => {
  it.each([
    ["2h", 7200],
    ["1h 30m", 5400],
    ["1h30m", 5400],
    ["90m", 5400],
    ["1:30", 5400],
    ["1.5h", 5400],
    [" 2H 15M ", 8100],
  ])("parses %s", (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it.each(["", "0m", "-1h", "1:60", "1.333h", "90", "one hour"])(
    "rejects %s",
    (input) => {
      expect(parseDurationToSeconds(input)).toBeNull();
    },
  );
});

describe("formatDuration", () => {
  it("formats totals without seconds", () => {
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(5400)).toBe("1h 30m");
  });
});

describe("formatTimerDuration", () => {
  it("formats a running timer as hours, minutes, and seconds", () => {
    expect(formatTimerDuration(0)).toBe("00:00:00");
    expect(formatTimerDuration(3661)).toBe("01:01:01");
  });
});
