const MAX_TIME_ENTRY_DURATION_SECONDS = 2_147_483_647;

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
