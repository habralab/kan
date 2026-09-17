import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, getDaysInMonth } from "date-fns";

import { isValidViewerTimeZone } from "./dueDateFilters";

export const cardRecurrenceRules = [
  "daily",
  "weekdays",
  "weekly",
  "monthly",
] as const;

export type CardRecurrenceRule = (typeof cardRecurrenceRules)[number];

interface RecurringCardDates {
  dueDate: Date;
  startDate: Date | null;
}

const atAnchorTime = (date: Date, anchor: TZDate, timeZone: string): TZDate =>
  TZDate.tz(
    timeZone,
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds(),
  );

const nextMonthlyDate = (
  current: TZDate,
  anchor: TZDate,
  timeZone: string,
): TZDate => {
  const anchorDay = anchor.getDate();
  const currentMonthAnchorDay = Math.min(anchorDay, getDaysInMonth(current));
  const useNextMonth = current.getDate() >= currentMonthAnchorDay;
  const firstOfTargetMonth = TZDate.tz(
    timeZone,
    current.getFullYear(),
    current.getMonth() + (useNextMonth ? 1 : 0),
    1,
    anchor.getHours(),
    anchor.getMinutes(),
    anchor.getSeconds(),
    anchor.getMilliseconds(),
  );

  firstOfTargetMonth.setDate(
    Math.min(anchorDay, getDaysInMonth(firstOfTargetMonth)),
  );
  return firstOfTargetMonth;
};

export const getNextRecurringCardDates = ({
  dueDate,
  startDate,
  recurrenceAnchorDate,
  recurrenceRule,
  recurrenceTimezone,
}: {
  dueDate: Date;
  startDate: Date | null;
  recurrenceAnchorDate: Date;
  recurrenceRule: CardRecurrenceRule;
  recurrenceTimezone: string;
}): RecurringCardDates => {
  if (!isValidViewerTimeZone(recurrenceTimezone)) {
    throw new RangeError("recurrenceTimezone must be a valid IANA timezone");
  }

  const current = TZDate.tz(recurrenceTimezone, dueDate);
  const anchor = TZDate.tz(recurrenceTimezone, recurrenceAnchorDate);
  let nextDueDate: TZDate;

  switch (recurrenceRule) {
    case "daily":
      nextDueDate = atAnchorTime(
        addDays(current, 1),
        anchor,
        recurrenceTimezone,
      );
      break;
    case "weekdays": {
      let nextDay = addDays(current, 1);
      while (nextDay.getDay() === 0 || nextDay.getDay() === 6) {
        nextDay = addDays(nextDay, 1);
      }
      nextDueDate = atAnchorTime(nextDay, anchor, recurrenceTimezone);
      break;
    }
    case "weekly": {
      const daysUntilAnchor = (anchor.getDay() - current.getDay() + 7) % 7 || 7;
      nextDueDate = atAnchorTime(
        addDays(current, daysUntilAnchor),
        anchor,
        recurrenceTimezone,
      );
      break;
    }
    case "monthly":
      nextDueDate = nextMonthlyDate(current, anchor, recurrenceTimezone);
      break;
  }

  const calendarDayShift = differenceInCalendarDays(nextDueDate, current);
  const nextStartDate = startDate
    ? addDays(TZDate.tz(recurrenceTimezone, startDate), calendarDayShift)
    : null;

  return {
    dueDate: new Date(nextDueDate.getTime()),
    startDate: nextStartDate ? new Date(nextStartDate.getTime()) : null,
  };
};
