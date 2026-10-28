import { describe, expect, it } from "vitest";

import {
  customReminderFromInput,
  customReminderInputValue,
  validCustomReminder,
} from "./reminder-custom";

describe("custom reminder form", () => {
  const due = new Date("2026-10-27T16:00:00.000Z");

  it("round trips a local date and time through the card's time zone", () => {
    const custom = customReminderFromInput(
      due,
      "2026-10-25T09:30",
      "Europe/Lisbon",
    );
    expect(custom).toEqual({
      daysBefore: 2,
      time: "09:30",
      timezone: "Europe/Lisbon",
    });
    expect(customReminderInputValue(due, custom!)).toBe("2026-10-25T09:30");
  });

  it("rejects reminder dates after the local due date", () => {
    expect(
      customReminderFromInput(due, "2026-10-28T09:00", "Europe/Lisbon"),
    ).toBeNull();
  });

  it("allows a date-only due reminder and rejects an invalid time zone", () => {
    const custom = { daysBefore: 0, time: "09:00", timezone: "Europe/Lisbon" };
    expect(validCustomReminder(due, false, custom)).toBe(true);
    expect(
      validCustomReminder(due, false, { ...custom, timezone: "Nope" }),
    ).toBe(false);
  });
});
