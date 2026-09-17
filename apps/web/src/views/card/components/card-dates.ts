import { isBefore, isSameDay, startOfDay } from "date-fns";

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
