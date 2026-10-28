import { TZDate, tzOffset } from "@date-fns/tz";

import { isValidViewerTimeZone } from "./dueDateFilters";

export interface CardReminderCustom {
  daysBefore: number;
  time: string;
  timezone: string;
}

export type CardDueReminderCustom = CardReminderCustom;

export function customReminderInstant(
  dueDate: Date,
  config: CardReminderCustom,
): Date {
  if (
    !Number.isInteger(config.daysBefore) ||
    config.daysBefore < 0 ||
    config.daysBefore > 365 ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.time) ||
    !isValidViewerTimeZone(config.timezone)
  )
    throw new RangeError("Invalid custom reminder configuration");
  const localDue = TZDate.tz(config.timezone, dueDate);
  const [hours, minutes] = config.time.split(":").map(Number) as [
    number,
    number,
  ];
  const wall = Date.UTC(
    localDue.getFullYear(),
    localDue.getMonth(),
    localDue.getDate() - config.daysBefore,
    hours,
    minutes,
  );
  // Select the earlier occurrence in an overlap. For a gap, advance the
  // requested wall clock to the first local minute that actually exists.
  const offsets = new Set<number>();
  for (let delta = -72; delta <= 72; delta += 6)
    offsets.add(tzOffset(config.timezone, new Date(wall + delta * 3600_000)));
  for (let advance = 0; advance <= 48 * 60; advance++) {
    const candidateWall = wall + advance * 60_000;
    const target = new Date(candidateWall);
    const matches = [...offsets]
      .map((offset) => candidateWall - offset * 60_000)
      .filter((instant) => {
        const local = TZDate.tz(config.timezone, new Date(instant));
        return (
          local.getFullYear() === target.getUTCFullYear() &&
          local.getMonth() === target.getUTCMonth() &&
          local.getDate() === target.getUTCDate() &&
          local.getHours() === target.getUTCHours() &&
          local.getMinutes() === target.getUTCMinutes()
        );
      });
    if (matches.length) return new Date(Math.min(...matches));
  }
  throw new RangeError("Unable to resolve custom reminder local time");
}

/** An occurrence after a timed deadline is skipped; the configuration remains reusable. */
export function customReminderForOccurrence(
  dueDate: Date,
  dueDateHasTime: boolean,
  config: CardReminderCustom,
): Date | null {
  const instant = customReminderInstant(dueDate, config);
  return dueDateHasTime && instant > dueDate ? null : instant;
}
