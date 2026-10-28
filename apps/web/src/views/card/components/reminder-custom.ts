import type { CardDueReminderCustom } from "@kan/shared/utils";
import { customReminderInstant } from "@kan/shared/utils";

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function utcDay(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

export function customReminderInputValue(
  dueDate: Date,
  custom: CardDueReminderCustom,
) {
  const dueDay = utcDay(localDateParts(dueDate, custom.timezone).date);
  const reminderDay = new Date(dueDay - custom.daysBefore * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return `${reminderDay}T${custom.time}`;
}

export function customReminderFromInput(
  dueDate: Date,
  input: string,
  timezone: string,
): CardDueReminderCustom | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const reminderDay = utcDay(input.slice(0, 10));
  const dueDay = utcDay(localDateParts(dueDate, timezone).date);
  const daysBefore = Math.round((dueDay - reminderDay) / 86_400_000);
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 365)
    return null;
  return { daysBefore, time: input.slice(11), timezone };
}

export function detectedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function validCustomReminder(
  dueDate: Date,
  dueDateHasTime: boolean,
  custom: CardDueReminderCustom,
) {
  try {
    const reminder = customReminderInstant(dueDate, custom);
    return !dueDateHasTime || reminder.getTime() <= dueDate.getTime();
  } catch {
    return false;
  }
}
