export const DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS = 60;
export const DEFAULT_MINIMUM_TIME_ENTRY_SECONDS = 60;

const MAX_TIME_ENTRY_DURATION_SECONDS = 2_147_483_647;
const MINIMUM_WORK_DATE = "1970-01-01";

const isPositiveDuration = (seconds: number) =>
  Number.isInteger(seconds) &&
  seconds > 0 &&
  seconds <= MAX_TIME_ENTRY_DURATION_SECONDS;

interface RoundTimerDurationOptions {
  rawElapsedSeconds: number;
  roundingIntervalSeconds?: number;
  minimumDurationSeconds?: number;
}

export const roundTimerDuration = ({
  rawElapsedSeconds,
  roundingIntervalSeconds = DEFAULT_TIME_ROUNDING_INTERVAL_SECONDS,
  minimumDurationSeconds = DEFAULT_MINIMUM_TIME_ENTRY_SECONDS,
}: RoundTimerDurationOptions): number => {
  if (!Number.isInteger(rawElapsedSeconds) || rawElapsedSeconds < 0) {
    throw new RangeError("Elapsed time must be a non-negative integer");
  }
  if (
    !Number.isInteger(roundingIntervalSeconds) ||
    roundingIntervalSeconds <= 0
  ) {
    throw new RangeError("Rounding interval must be a positive integer");
  }
  if (
    !Number.isInteger(minimumDurationSeconds) ||
    minimumDurationSeconds <= 0
  ) {
    throw new RangeError("Minimum duration must be a positive integer");
  }

  const roundedSeconds =
    Math.round(rawElapsedSeconds / roundingIntervalSeconds) *
    roundingIntervalSeconds;
  const duration = Math.max(minimumDurationSeconds, roundedSeconds);

  if (!isPositiveDuration(duration)) {
    throw new RangeError("Rounded duration is outside the supported range");
  }

  return duration;
};

export const isValidIanaTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
};

export const getWorkDateInTimezone = (date: Date, timezone: string): string => {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Date must be valid");
  }
  if (!isValidIanaTimezone(timezone)) {
    throw new RangeError("Timezone must be a valid IANA timezone");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;

  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const isValidWorkDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || value < MINIMUM_WORK_DATE) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= (daysInMonth[month - 1] ?? 0)
  );
};
