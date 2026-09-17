import { enGB, ru } from "date-fns/locale";
import { describe, expect, it } from "vitest";

import {
  datesMatch,
  formatCardDate,
  getCardDeadlineState,
  orderCardDateRange,
} from "../../../utils/cardDates";

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

describe("card deadline presentation", () => {
  const dueDate = new Date(2026, 8, 17, 19, 0);
  const now = new Date(2026, 8, 17, 12, 0);

  it("uses completion before overdue state", () => {
    expect(
      getCardDeadlineState({
        completed: true,
        dueDate: new Date(2026, 8, 16),
        dueDateHasTime: false,
        now,
      }),
    ).toBe("completed");
  });

  it("keeps an untimed due date current through the end of its day", () => {
    expect(
      getCardDeadlineState({
        completed: false,
        dueDate: new Date(2026, 8, 17),
        dueDateHasTime: false,
        now,
      }),
    ).toBe("upcoming");
  });

  it("compares timed due dates with the current instant", () => {
    expect(
      getCardDeadlineState({
        completed: false,
        dueDate: new Date(2026, 8, 17, 11, 59),
        dueDateHasTime: true,
        now,
      }),
    ).toBe("overdue");
  });

  it("formats dates in locale order without ordinal suffixes", () => {
    expect(formatCardDate(dueDate, { locale: ru, includeYear: false })).toMatch(
      /^17\s/,
    );
    expect(formatCardDate(dueDate, { locale: ru })).not.toContain("-е");
    expect(formatCardDate(dueDate, { locale: enGB })).toMatch(/^17\s/);
  });
});
