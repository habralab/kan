import { describe, expect, it } from "vitest";

import {
  convertDueDateFiltersToRanges,
  isValidViewerTimeZone,
} from "./dueDateFilters";

const now = new Date("2024-03-31T12:00:00.000Z");

describe("convertDueDateFiltersToRanges", () => {
  it("uses UTC calendar boundaries when no viewer timezone is supplied", () => {
    const ranges = convertDueDateFiltersToRanges(
      ["today", "tomorrow", "next-week", "next-month"],
      undefined,
      now,
    );

    expect(ranges).toEqual([
      {
        startDate: new Date("2024-03-31T00:00:00.000Z"),
        endDate: new Date("2024-04-01T00:00:00.000Z"),
      },
      {
        startDate: new Date("2024-04-01T00:00:00.000Z"),
        endDate: new Date("2024-04-02T00:00:00.000Z"),
      },
      {
        startDate: new Date("2024-03-31T00:00:00.000Z"),
        endDate: new Date("2024-04-08T00:00:00.000Z"),
      },
      {
        startDate: new Date("2024-04-08T00:00:00.000Z"),
        endDate: new Date("2024-05-01T00:00:00.000Z"),
      },
    ]);
  });

  it("uses Europe/Lisbon calendar boundaries across the DST transition", () => {
    const ranges = convertDueDateFiltersToRanges(
      ["today", "tomorrow", "next-week", "next-month"],
      "Europe/Lisbon",
      now,
    );

    expect(ranges).toEqual([
      {
        startDate: new Date("2024-03-31T00:00:00.000Z"),
        endDate: new Date("2024-03-31T23:00:00.000Z"),
      },
      {
        startDate: new Date("2024-03-31T23:00:00.000Z"),
        endDate: new Date("2024-04-01T23:00:00.000Z"),
      },
      {
        startDate: new Date("2024-03-31T00:00:00.000Z"),
        endDate: new Date("2024-04-07T23:00:00.000Z"),
      },
      {
        startDate: new Date("2024-04-07T23:00:00.000Z"),
        endDate: new Date("2024-04-30T23:00:00.000Z"),
      },
    ]);
  });

  it("uses a 25-hour local day when Europe/Lisbon leaves daylight saving time", () => {
    const ranges = convertDueDateFiltersToRanges(
      ["today", "tomorrow"],
      "Europe/Lisbon",
      new Date("2024-10-27T12:00:00.000Z"),
    );

    expect(ranges).toEqual([
      {
        startDate: new Date("2024-10-26T23:00:00.000Z"),
        endDate: new Date("2024-10-28T00:00:00.000Z"),
      },
      {
        startDate: new Date("2024-10-28T00:00:00.000Z"),
        endDate: new Date("2024-10-29T00:00:00.000Z"),
      },
    ]);
  });

  it("keeps date-only deadlines until the next day but checks timed deadlines at the exact instant", () => {
    const ranges = convertDueDateFiltersToRanges(
      ["overdue", "no-due-date"],
      "UTC",
      now,
    );

    expect(ranges).toEqual([
      {
        endDate: new Date("2024-03-31T00:00:00.000Z"),
        timedEndDate: now,
      },
      { hasNoDueDate: true },
    ]);
  });

  it("only accepts IANA viewer timezone identifiers", () => {
    expect(isValidViewerTimeZone("Europe/Lisbon")).toBe(true);
    expect(isValidViewerTimeZone("UTC")).toBe(true);
    expect(isValidViewerTimeZone("GMT+01:00")).toBe(false);
    expect(isValidViewerTimeZone("not-a-timezone")).toBe(false);
  });
});
