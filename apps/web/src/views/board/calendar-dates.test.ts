import { describe, expect, it } from "vitest";

import type { CalendarCard } from "./calendar-dates";
import {
  getCalendarChecklistEntries,
  getCalendarEntries,
  shiftCalendarDates,
} from "./calendar-dates";

const card = (
  publicId: string,
  startDate: Date | null,
  dueDate: Date | null,
): CalendarCard => ({
  publicId,
  title: publicId,
  cardNumber: null,
  startDate,
  dueDate,
  dueDateHasTime: false,
  completed: false,
  labels: [],
});

describe("shiftCalendarDates", () => {
  it("moves a timed deadline without clearing its time setting", () => {
    const result = shiftCalendarDates(
      {
        startDate: null,
        dueDate: new Date(2026, 8, 15, 18, 30),
        dueDateHasTime: true,
      },
      new Date(2026, 8, 15),
      new Date(2026, 8, 20),
    );

    expect(result).toEqual({
      dueDate: new Date(2026, 8, 20, 18, 30),
      dueDateHasTime: true,
    });
  });

  it("moves both ends of a date range by the same number of calendar days", () => {
    const result = shiftCalendarDates(
      {
        startDate: new Date(2026, 8, 15, 9),
        dueDate: new Date(2026, 8, 17, 18, 30),
        dueDateHasTime: true,
      },
      new Date(2026, 8, 16),
      new Date(2026, 8, 20),
    );

    expect(result).toEqual({
      startDate: new Date(2026, 8, 19, 9),
      dueDate: new Date(2026, 8, 21, 18, 30),
      dueDateHasTime: true,
    });
  });

  it("moves a start-only card without adding a due date", () => {
    const result = shiftCalendarDates(
      {
        startDate: new Date(2026, 8, 15),
        dueDate: null,
        dueDateHasTime: false,
      },
      new Date(2026, 8, 15),
      new Date(2026, 8, 20),
    );

    expect(result).toEqual({ startDate: new Date(2026, 8, 20) });
  });

  it("preserves local wall-clock time when moving across a DST boundary", () => {
    const result = shiftCalendarDates(
      {
        startDate: null,
        dueDate: new Date(2026, 2, 7, 18, 30),
        dueDateHasTime: true,
      },
      new Date(2026, 2, 7),
      new Date(2026, 2, 9),
    );

    expect(result.dueDate).toEqual(new Date(2026, 2, 9, 18, 30));
    expect(result.dueDateHasTime).toBe(true);
  });
});

describe("getCalendarEntries", () => {
  const visibleDates = Array.from(
    { length: 7 },
    (_, index) => new Date(2026, 8, 14 + index),
  );

  it("shows a period on each day and a start-only card at its start", () => {
    const entries = getCalendarEntries(
      [
        {
          cards: [
            card("period", new Date(2026, 8, 15), new Date(2026, 8, 17)),
            card("start-only", new Date(2026, 8, 16), null),
          ],
        },
      ],
      visibleDates,
    );

    expect(entries.get("2026-09-15")?.map(({ position }) => position)).toEqual([
      "start",
    ]);
    expect(entries.get("2026-09-16")?.map(({ position }) => position)).toEqual([
      "middle",
      "start-only",
    ]);
    expect(entries.get("2026-09-17")?.map(({ position }) => position)).toEqual([
      "end",
    ]);
  });

  it("clips a period to the visible calendar without losing its end marker", () => {
    const entries = getCalendarEntries(
      [
        {
          cards: [card("period", new Date(2026, 8, 10), new Date(2026, 8, 15))],
        },
      ],
      visibleDates,
    );

    expect(entries.get("2026-09-14")?.[0]?.position).toBe("middle");
    expect(entries.get("2026-09-15")?.[0]?.position).toBe("end");
    expect(entries.has("2026-09-16")).toBe(false);
  });

  it("keeps all cards in a busy day accessible", () => {
    const entries = getCalendarEntries(
      [
        {
          cards: Array.from({ length: 4 }, (_, index) =>
            card(`card-${index}`, null, new Date(2026, 8, 15)),
          ),
        },
      ],
      visibleDates,
    );

    expect(entries.get("2026-09-15")).toHaveLength(4);
  });

  it("shows a reversed legacy range on its due day only", () => {
    const entries = getCalendarEntries(
      [
        {
          cards: [card("legacy", new Date(2026, 8, 20), new Date(2026, 8, 15))],
        },
      ],
      visibleDates,
    );

    expect(entries.get("2026-09-15")?.[0]?.card.publicId).toBe("legacy");
    expect(entries.has("2026-09-20")).toBe(false);
  });
});

describe("getCalendarChecklistEntries", () => {
  it("keeps dated items only for cards visible through board filters", () => {
    const dueDate = new Date(2026, 8, 15, 18);
    const items = [
      {
        publicId: "item-visible",
        title: "Prepare the route",
        completed: false,
        dueDate,
        dueDateHasTime: true,
        cardPublicId: "card-visible",
      },
      {
        publicId: "item-filtered",
        title: "Hidden by board filter",
        completed: false,
        dueDate,
        dueDateHasTime: false,
        cardPublicId: "card-filtered",
      },
    ];

    const entries = getCalendarChecklistEntries(
      items,
      [new Date(2026, 8, 15)],
      new Set(["card-visible"]),
    );

    expect(entries.get("2026-09-15")?.map((item) => item.publicId)).toEqual([
      "item-visible",
    ]);
  });
});
