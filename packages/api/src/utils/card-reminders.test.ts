import { describe, expect, it } from "vitest";

import { reminderInstant } from "./card-reminders";

describe("reminderInstant", () => {
  it.each([
    [0, "2026-01-01T00:05:00.000Z"],
    [5, "2026-01-01T00:00:00.000Z"],
    [10, "2025-12-31T23:55:00.000Z"],
    [1440, "2025-12-31T00:05:00.000Z"],
  ])("subtracts %i minutes from the due instant", (minutes, expected) => {
    const due = new Date("2026-01-01T00:05:00.000Z");
    expect(reminderInstant(due, minutes).toISOString()).toBe(expected);
    expect(due.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });
});
