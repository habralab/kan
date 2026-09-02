const MAX_TIME_ENTRY_DURATION_SECONDS = 2_147_483_647;

export const TIME_TRACKING_CHANNEL_NAME = "kan-time-tracking";

export type TimeTrackingPeriod =
  | "all"
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "last-14-days"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "last-quarter"
  | "this-year"
  | "last-year";

const formatLocalDate = (date: Date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

const addLocalDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const startOfLocalWeek = (date: Date) =>
  addLocalDays(date, -((date.getDay() + 6) % 7));

export const getTimeTrackingPeriodRange = (
  period: TimeTrackingPeriod,
  now = new Date(),
): { dateFrom: string; dateTo: string } | undefined => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let dateFrom: Date;
  let dateTo: Date;

  switch (period) {
    case "all":
      return undefined;
    case "today":
      dateFrom = today;
      dateTo = today;
      break;
    case "yesterday":
      dateFrom = addLocalDays(today, -1);
      dateTo = dateFrom;
      break;
    case "this-week":
      dateFrom = startOfLocalWeek(today);
      dateTo = addLocalDays(dateFrom, 6);
      break;
    case "last-week":
      dateFrom = addLocalDays(startOfLocalWeek(today), -7);
      dateTo = addLocalDays(dateFrom, 6);
      break;
    case "last-14-days":
      dateFrom = addLocalDays(today, -13);
      dateTo = today;
      break;
    case "this-month":
      dateFrom = new Date(today.getFullYear(), today.getMonth(), 1);
      dateTo = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      break;
    case "last-month":
      dateFrom = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      dateTo = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    case "this-quarter": {
      const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
      dateFrom = new Date(today.getFullYear(), quarterMonth, 1);
      dateTo = new Date(today.getFullYear(), quarterMonth + 3, 0);
      break;
    }
    case "last-quarter": {
      const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
      dateFrom = new Date(today.getFullYear(), quarterMonth - 3, 1);
      dateTo = new Date(today.getFullYear(), quarterMonth, 0);
      break;
    }
    case "this-year":
      dateFrom = new Date(today.getFullYear(), 0, 1);
      dateTo = new Date(today.getFullYear(), 11, 31);
      break;
    case "last-year":
      dateFrom = new Date(today.getFullYear() - 1, 0, 1);
      dateTo = new Date(today.getFullYear() - 1, 11, 31);
      break;
  }

  return {
    dateFrom: formatLocalDate(dateFrom),
    dateTo: formatLocalDate(dateTo),
  };
};

const isPositiveDuration = (seconds: number) =>
  Number.isInteger(seconds) &&
  seconds > 0 &&
  seconds <= MAX_TIME_ENTRY_DURATION_SECONDS;

export const parseDurationToSeconds = (input: string): number | null => {
  const value = input.trim().toLowerCase();

  const colonMatch = /^(\d+):([0-5]\d)$/.exec(value);
  if (colonMatch) {
    const seconds = Number(colonMatch[1]) * 3600 + Number(colonMatch[2]) * 60;
    return isPositiveDuration(seconds) ? seconds : null;
  }

  const unitMatch = /^(?:(\d+(?:\.\d+)?)\s*h)?(?:\s*(\d+)\s*m)?$/.exec(value);
  if (!unitMatch || (!unitMatch[1] && !unitMatch[2])) {
    return null;
  }

  const seconds =
    Number(unitMatch[1] ?? 0) * 3600 + Number(unitMatch[2] ?? 0) * 60;

  return isPositiveDuration(seconds) ? seconds : null;
};

export const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

export const formatTimerDuration = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
};
