import { describe, expect, it } from "vitest";

import {
  customReminderForOccurrence,
  customReminderInstant,
} from "./cardReminder";

describe("customReminderInstant", () => {
  it("preserves local wall time across daylight saving changes", () => {
    const config = {
      daysBefore: 1,
      time: "09:00",
      timezone: "America/New_York",
    };
    expect(
      customReminderInstant(
        new Date("2026-03-08T16:00:00Z"),
        config,
      ).toISOString(),
    ).toBe("2026-03-07T14:00:00.000Z");
    expect(
      customReminderInstant(
        new Date("2026-03-09T16:00:00Z"),
        config,
      ).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
  });
  it.each([
    ["2026-03-08T16:00:00Z", "02:30", "2026-03-08T07:00:00.000Z"],
    ["2026-11-01T16:00:00Z", "01:30", "2026-11-01T05:30:00.000Z"],
  ])(
    "resolves gaps forward and overlaps to the earlier instant",
    (due, time, expected) => {
      expect(
        customReminderInstant(new Date(due), {
          daysBefore: 0,
          time,
          timezone: "America/New_York",
        }).toISOString(),
      ).toBe(expected);
    },
  );
  it("skips an after-deadline occurrence but keeps the configuration reusable", () => {
    const config = {
      daysBefore: 0,
      time: "02:30",
      timezone: "America/New_York",
    };
    const due = new Date("2026-03-08T06:45:00Z");
    expect(customReminderForOccurrence(due, true, config)).toBeNull();
    expect(customReminderForOccurrence(due, false, config)?.toISOString()).toBe(
      "2026-03-08T07:00:00.000Z",
    );
    expect(
      customReminderForOccurrence(
        new Date("2026-03-09T06:45:00Z"),
        true,
        config,
      )?.toISOString(),
    ).toBe("2026-03-09T06:30:00.000Z");
  });
  it("rejects invalid timezone and wall time", () => {
    expect(() =>
      customReminderInstant(new Date(), {
        daysBefore: 0,
        time: "25:00",
        timezone: "UTC",
      }),
    ).toThrow();
    expect(() =>
      customReminderInstant(new Date(), {
        daysBefore: 0,
        time: "09:00",
        timezone: "Invalid/Zone",
      }),
    ).toThrow();
  });
});
