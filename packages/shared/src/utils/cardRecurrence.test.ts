import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";

import { getNextRecurringCardDates } from "./cardRecurrence";

const inZone = (
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
) =>
  new Date(TZDate.tz(timeZone, year, month - 1, day, hour, minute).getTime());

describe("card recurrence", () => {
  it("advances daily while preserving local wall-clock time across DST", () => {
    const timeZone = "Europe/Lisbon";
    const dueDate = inZone(timeZone, 2026, 3, 28, 19);

    expect(
      getNextRecurringCardDates({
        dueDate,
        startDate: null,
        recurrenceAnchorDate: dueDate,
        recurrenceRule: "daily",
        recurrenceTimezone: timeZone,
      }).dueDate,
    ).toEqual(inZone(timeZone, 2026, 3, 29, 19));
  });

  it("moves weekday recurrence from Friday to Monday", () => {
    const timeZone = "UTC";
    const dueDate = inZone(timeZone, 2026, 9, 18, 10);

    expect(
      getNextRecurringCardDates({
        dueDate,
        startDate: null,
        recurrenceAnchorDate: dueDate,
        recurrenceRule: "weekdays",
        recurrenceTimezone: timeZone,
      }).dueDate,
    ).toEqual(inZone(timeZone, 2026, 9, 21, 10));
  });

  it("returns to the anchored weekday after a manual occurrence shift", () => {
    const timeZone = "UTC";

    expect(
      getNextRecurringCardDates({
        dueDate: inZone(timeZone, 2026, 9, 17, 9),
        startDate: null,
        recurrenceAnchorDate: inZone(timeZone, 2026, 9, 9, 16),
        recurrenceRule: "weekly",
        recurrenceTimezone: timeZone,
      }).dueDate,
    ).toEqual(inZone(timeZone, 2026, 9, 23, 16));
  });

  it("keeps a month-end anchor instead of drifting after February", () => {
    const timeZone = "America/New_York";
    const anchor = inZone(timeZone, 2026, 1, 31, 18);
    const february = getNextRecurringCardDates({
      dueDate: anchor,
      startDate: null,
      recurrenceAnchorDate: anchor,
      recurrenceRule: "monthly",
      recurrenceTimezone: timeZone,
    }).dueDate;
    const march = getNextRecurringCardDates({
      dueDate: february,
      startDate: null,
      recurrenceAnchorDate: anchor,
      recurrenceRule: "monthly",
      recurrenceTimezone: timeZone,
    }).dueDate;

    expect(february).toEqual(inZone(timeZone, 2026, 2, 28, 18));
    expect(march).toEqual(inZone(timeZone, 2026, 3, 31, 18));
  });

  it("preserves a date range in local calendar days", () => {
    const timeZone = "Europe/Lisbon";
    const dueDate = inZone(timeZone, 2026, 3, 28, 19);
    const startDate = inZone(timeZone, 2026, 3, 25);
    const next = getNextRecurringCardDates({
      dueDate,
      startDate,
      recurrenceAnchorDate: dueDate,
      recurrenceRule: "weekly",
      recurrenceTimezone: timeZone,
    });

    expect(next.dueDate).toEqual(inZone(timeZone, 2026, 4, 4, 19));
    expect(next.startDate).toEqual(inZone(timeZone, 2026, 4, 1));
  });

  it("rejects invalid timezones", () => {
    expect(() =>
      getNextRecurringCardDates({
        dueDate: new Date(),
        startDate: null,
        recurrenceAnchorDate: new Date(),
        recurrenceRule: "daily",
        recurrenceTimezone: "not/a-timezone",
      }),
    ).toThrow(RangeError);
  });
});
