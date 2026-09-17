import { describe, expect, it } from "vitest";

import { datesMatch, orderCardDateRange } from "./card-dates";

describe("card date ranges", () => {
  it("orders selected dates while preserving the due time", () => {
    const existingDueDate = new Date(2026, 8, 20, 15, 30);
    const selectedDate = new Date(2026, 8, 25, 15, 30);

    expect(orderCardDateRange(existingDueDate, selectedDate)).toEqual({
      startDate: new Date(2026, 8, 20),
      dueDate: selectedDate,
    });
    expect(orderCardDateRange(selectedDate, existingDueDate)).toEqual({
      startDate: new Date(2026, 8, 20),
      dueDate: selectedDate,
    });
  });

  it("treats selecting the same day as a due date without a start date", () => {
    const first = new Date(2026, 8, 20, 8, 0);
    const second = new Date(2026, 8, 20, 18, 0);

    expect(orderCardDateRange(first, second)).toEqual({
      startDate: null,
      dueDate: second,
    });
  });

  it("compares nullable dates by their timestamp", () => {
    expect(datesMatch(null, undefined)).toBe(true);
    expect(datesMatch(new Date(2026, 8, 20), new Date(2026, 8, 20))).toBe(true);
    expect(datesMatch(new Date(2026, 8, 20), new Date(2026, 8, 21))).toBe(
      false,
    );
  });
});
