import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatTimerDuration,
  parseDurationToSeconds,
} from "./timeTracking";

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
