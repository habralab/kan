import { useEffect, useState } from "react";

import { formatTimerDuration } from "~/utils/timeTracking";

const getElapsedSeconds = (startedAtMs: number) =>
  Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

export function ElapsedTimer({ startedAt }: { startedAt: Date }) {
  const startedAtMs = startedAt.getTime();
  const [elapsedSeconds, setElapsedSeconds] = useState(() =>
    getElapsedSeconds(startedAtMs),
  );

  useEffect(() => {
    const updateElapsed = () =>
      setElapsedSeconds(getElapsedSeconds(startedAtMs));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [startedAtMs]);

  return formatTimerDuration(elapsedSeconds);
}
