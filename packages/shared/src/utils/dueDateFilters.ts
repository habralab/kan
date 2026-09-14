export type DueDateFilterKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "next-week"
  | "next-month"
  | "no-due-date";

export interface DueDateFilter {
  startDate?: Date;
  endDate?: Date;
  timedEndDate?: Date;
  hasNoDueDate?: boolean;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const UTC_TIME_ZONE = "UTC";

const getCalendarDate = (
  date: Date,
  formatter: Intl.DateTimeFormat,
): CalendarDate => {
  const parts = formatter.formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Unable to determine ${type}`);
    return Number(value);
  };

  return {
    year: getPart("year"),
    month: getPart("month"),
    day: getPart("day"),
  };
};

const compareCalendarDates = (left: CalendarDate, right: CalendarDate) =>
  left.year - right.year || left.month - right.month || left.day - right.day;

const addCalendarDays = (date: CalendarDate, days: number): CalendarDate => {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
};

/**
 * Finds midnight for a calendar date in a viewer's timezone without changing
 * the meaning of stored UTC instants. The binary search also handles DST
 * offsets that differ on either side of midnight.
 */
const startOfDayInTimeZone = (
  date: CalendarDate,
  formatter: Intl.DateTimeFormat,
): Date => {
  const estimatedMidnight = Date.UTC(date.year, date.month - 1, date.day);
  let low = estimatedMidnight - 36 * 60 * 60 * 1000;
  let high = estimatedMidnight + 36 * 60 * 60 * 1000;

  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (
      compareCalendarDates(getCalendarDate(new Date(middle), formatter), date) <
      0
    ) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return new Date(low);
};

export const isValidViewerTimeZone = (timeZone: string): boolean => {
  if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)$/.test(timeZone)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

export const convertDueDateFiltersToRanges = (
  filters: DueDateFilterKey[],
  viewerTimeZone = UTC_TIME_ZONE,
  now = new Date(),
): DueDateFilter[] => {
  if (!filters.length) return [];

  const timeZone = isValidViewerTimeZone(viewerTimeZone)
    ? viewerTimeZone
    : UTC_TIME_ZONE;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  const today = getCalendarDate(now, formatter);
  const tomorrow = addCalendarDays(today, 1);
  const nextWeek = addCalendarDays(today, 8);
  const nextMonth = addCalendarDays(today, 31);

  return filters.map((filter) => {
    switch (filter) {
      case "overdue":
        return {
          endDate: startOfDayInTimeZone(today, formatter),
          timedEndDate: now,
        };
      case "today":
        return {
          startDate: startOfDayInTimeZone(today, formatter),
          endDate: startOfDayInTimeZone(tomorrow, formatter),
        };
      case "tomorrow":
        return {
          startDate: startOfDayInTimeZone(tomorrow, formatter),
          endDate: startOfDayInTimeZone(
            addCalendarDays(tomorrow, 1),
            formatter,
          ),
        };
      case "next-week": {
        return {
          startDate: startOfDayInTimeZone(today, formatter),
          endDate: startOfDayInTimeZone(nextWeek, formatter),
        };
      }
      case "next-month": {
        return {
          startDate: startOfDayInTimeZone(nextWeek, formatter),
          endDate: startOfDayInTimeZone(nextMonth, formatter),
        };
      }
      case "no-due-date":
        return {
          hasNoDueDate: true,
        };
      default:
        return {};
    }
  });
};
