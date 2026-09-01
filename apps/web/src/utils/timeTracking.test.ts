import { describe, expect, it } from "vitest";

import { parseDurationToSeconds } from "./timeTracking";

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
