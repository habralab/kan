import { describe, expect, it } from "vitest";

import {
  getWorkDateInTimezone,
  isValidIanaTimezone,
  isValidWorkDate,
  roundTimerDuration,
} from "./timeTracking";

describe("roundTimerDuration", () => {
  it.each([
    [0, 60],
    [29, 60],
    [30, 60],
    [89, 60],
    [90, 120],
    [149, 120],
    [150, 180],
  ])("rounds %i seconds to %i seconds", (rawElapsedSeconds, expected) => {
    expect(roundTimerDuration({ rawElapsedSeconds })).toBe(expected);
  });

  it("supports board-specific rounding and minimum duration", () => {
    expect(
      roundTimerDuration({
        rawElapsedSeconds: 61,
        roundingIntervalSeconds: 300,
        minimumDurationSeconds: 900,
      }),
    ).toBe(900);
  });

  it.each([-1, 1.5])(
    "rejects an invalid elapsed duration: %s",
    (rawElapsedSeconds) => {
      expect(() => roundTimerDuration({ rawElapsedSeconds })).toThrow(
        RangeError,
      );
    },
  );
});

describe("work dates", () => {
  it("derives the date in the user's timezone", () => {
    const date = new Date("2026-08-31T23:30:00.000Z");

    expect(getWorkDateInTimezone(date, "UTC")).toBe("2026-08-31");
    expect(getWorkDateInTimezone(date, "Europe/Lisbon")).toBe("2026-09-01");
  });

  it("validates IANA timezones", () => {
    expect(isValidIanaTimezone("Europe/Lisbon")).toBe(true);
    expect(isValidIanaTimezone("not/a-timezone")).toBe(false);
  });

  it.each(["1970-01-01", "2024-02-29", "9999-12-31"])(
    "accepts the work date %s",
    (date) => {
      expect(isValidWorkDate(date)).toBe(true);
    },
  );

  it.each([
    "0001-10-16",
    "2023-02-29",
    "2026-02-30",
    "2026-13-01",
    "01-01-2026",
  ])("rejects the work date %s", (date) => {
    expect(isValidWorkDate(date)).toBe(false);
  });
});
