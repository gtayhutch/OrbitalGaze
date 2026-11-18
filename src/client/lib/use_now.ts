/**
 * @fileoverview Hook for the current time, refreshed on an interval.
 *
 * Layer: client library (browser only).
 *
 * Relative times on screen ("Updated 4 min ago") need to move on by
 * themselves. This hook re-renders its component every `intervalMs` with the
 * new time, and stops when the component goes away.
 */
import {useEffect, useState} from 'react';

/** Default refresh interval: once a minute, enough for "N min ago" text. */
const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Returns the current time, updated every `intervalMs` milliseconds.
 *
 * @param intervalMs How often to update; defaults to once a minute.
 * @returns The time as of the latest update.
 * @example
 * const now = useNow();
 * const label = formatAge(now.getTime() - updatedAt.getTime());
 */
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);

  return now;
}
