import type { Locale } from "date-fns";
import { isBefore, isSameDay, startOfDay } from "date-fns";

export type CardDeadlineState = "completed" | "overdue" | "upcoming";

export function getCardDeadlineState({
  completed,
  dueDate,
  dueDateHasTime,
  now = new Date(),
}: {
  completed: boolean;
  dueDate: Date;
  dueDateHasTime: boolean;
  now?: Date;
}): CardDeadlineState {
  if (completed) return "completed";

  const overdueBoundary = dueDateHasTime ? now : startOfDay(now);
  return isBefore(dueDate, overdueBoundary) ? "overdue" : "upcoming";
}

export function formatCardDate(
  date: Date,
  {
    locale,
    includeTime = false,
    includeYear = true,
  }: {
    locale: Locale;
    includeTime?: boolean;
    includeYear?: boolean;
  },
) {
  return new Intl.DateTimeFormat(locale.code, {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" as const } : {}),
    ...(includeTime
      ? { hour: "2-digit" as const, minute: "2-digit" as const }
      : {}),
  }).format(date);
}

export function orderCardDateRange(first: Date, second: Date) {
  if (isSameDay(first, second)) {
    return { startDate: null, dueDate: second };
  }

  return isBefore(first, second)
    ? { startDate: startOfDay(first), dueDate: second }
    : { startDate: startOfDay(second), dueDate: first };
}

export function datesMatch(
  first: Date | null | undefined,
  second: Date | null | undefined,
) {
  return first?.getTime() === second?.getTime();
}
