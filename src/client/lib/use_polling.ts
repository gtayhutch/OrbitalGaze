/**
 * @fileoverview Hook that loads data now and again on a fixed interval.
 *
 * Layer: client library (browser only). Used by `use_layer_snapshot.ts`
 * for map layers that change over time; usable for any repeated GET.
 *
 * The loop is careful with the server and the visitor's battery:
 * - **No overlap.** The next request is scheduled only after the current
 *   one finishes, so a slow response never stacks up requests.
 * - **Hidden tabs pause.** While `document.hidden` is true no new request
 *   starts; when the tab becomes visible again it refreshes at once.
 * - **Backoff.** After a failure the wait doubles each time (2×, 4×, 8× the
 *   interval), up to a cap, and returns to the normal interval after the
 *   next success.
 * - **Cancellation.** Turning polling off, changing `key`, or unmounting
 *   aborts the request in flight and clears the timer.
 * - **Last good data.** A failed refresh keeps showing the previous result
 *   (flagged as `lastAttemptFailed`) instead of blanking the screen.
 *
 * The loop lives in one effect with plain local variables (timer, in-flight
 * flag, failure count), because they drive scheduling rather than
 * rendering. React state holds only what the caller renders.
 */
import {useEffect, useRef, useState} from 'react';

/**
 * Default longest wait between attempts while requests keep failing, in
 * milliseconds (15 minutes): long enough to stop pressing a struggling
 * server, short enough that data returns soon after it recovers.
 */
export const DEFAULT_MAX_BACKOFF_MS = 15 * 60 * 1000;

/** Options for {@link usePolling}. */
export interface PollingOptions {
  /**
   * Names what is being polled (for example a layer ID). Changing it
   * cancels the current loop and starts over with no data.
   */
  readonly key: string;
  /** Wait between the end of one successful request and the next, in ms. */
  readonly intervalMs: number;
  /** False stops polling and cancels any request in flight. Default true. */
  readonly enabled?: boolean;
  /** Longest wait while failing, in ms. Default {@link DEFAULT_MAX_BACKOFF_MS}. */
  readonly maxBackoffMs?: number;
}

/**
 * What {@link usePolling} returns.
 *
 * - `loading`: nothing has loaded yet for this key (also while the tab is
 *   hidden at first, or while polling is disabled).
 * - `ready`: the latest successful result. `lastAttemptFailed` is true when
 *   a later refresh failed and this is older data.
 * - `error`: every attempt for this key has failed so far.
 */
export type PollingState<Data> =
  | {readonly status: 'loading'}
  | {
      readonly status: 'ready';
      readonly data: Data;
      readonly lastAttemptFailed: boolean;
    }
  | {readonly status: 'error'; readonly error: unknown};

/** A state remembered with the key it belongs to. */
interface StoredState<Data> {
  readonly key: string;
  readonly state: PollingState<Data>;
}

/** The state before anything has loaded. */
const LOADING: PollingState<never> = {status: 'loading'};

/**
 * Works out how long to wait before the next request.
 *
 * @param intervalMs The normal interval.
 * @param consecutiveFailures Failed attempts since the last success.
 * @param maxBackoffMs The longest wait while failing.
 * @returns `intervalMs` after a success; otherwise
 *     `intervalMs × 2^failures`, capped at `maxBackoffMs` but never shorter
 *     than `intervalMs`.
 * @example
 * nextPollDelayMs(60_000, 0, 900_000); // 60_000
 * nextPollDelayMs(60_000, 2, 900_000); // 240_000
 * nextPollDelayMs(60_000, 9, 900_000); // 900_000 (capped)
 */
export function nextPollDelayMs(
  intervalMs: number,
  consecutiveFailures: number,
  maxBackoffMs: number,
): number {
  if (consecutiveFailures <= 0) {
    return intervalMs;
  }
  const backoffMs = intervalMs * 2 ** consecutiveFailures;
  return Math.max(intervalMs, Math.min(backoffMs, maxBackoffMs));
}

/**
 * Builds the state after a failed attempt: older data is kept if there is
 * any for this key; otherwise the state becomes an error.
 *
 * @param previous The stored state before the attempt.
 * @param key The key being polled.
 * @param error What the attempt threw.
 * @returns The new stored state.
 */
function afterFailure<Data>(
  previous: StoredState<Data> | null,
  key: string,
  error: unknown,
): StoredState<Data> {
  if (previous?.key === key && previous.state.status === 'ready') {
    return {key, state: {...previous.state, lastAttemptFailed: true}};
  }
  return {key, state: {status: 'error', error}};
}

/**
 * Calls `load` now and then repeatedly, as described in the file header.
 *
 * @param load Fetches the data. It must pass `signal` to `fetch` so the
 *     request is cancelled with the loop. The latest function is always
 *     used, so it may be an inline closure; only `key` restarts the loop.
 * @param options The key, interval, and on/off switch.
 * @returns The current state for `options.key`.
 * @example
 * const state = usePolling(signal => getJson(path, schema, signal), {
 *   key: path,
 *   intervalMs: 60_000,
 * });
 */
export function usePolling<Data>(
  load: (signal: AbortSignal) => Promise<Data>,
  options: PollingOptions,
): PollingState<Data> {
  const {
    key,
    intervalMs,
    enabled = true,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  } = options;
  const [stored, setStored] = useState<StoredState<Data> | null>(null);

  // Keep the newest `load` without restarting the loop on every render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const controller = new AbortController();
    let timer: number | undefined;
    let inFlight = false;
    let consecutiveFailures = 0;

    const clearTimer = (): void => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    // Schedules the next request. While the tab is hidden nothing is
    // scheduled; the visibility listener below restarts the loop.
    const scheduleNext = (): void => {
      if (document.hidden) {
        return;
      }
      const delayMs = nextPollDelayMs(
        intervalMs,
        consecutiveFailures,
        maxBackoffMs,
      );
      timer = window.setTimeout(() => {
        void poll();
      }, delayMs);
    };

    // One request. Results that arrive after cancellation are ignored.
    const poll = async (): Promise<void> => {
      clearTimer();
      inFlight = true;
      try {
        const data = await loadRef.current(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        consecutiveFailures = 0;
        setStored({
          key,
          state: {status: 'ready', data, lastAttemptFailed: false},
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        consecutiveFailures += 1;
        setStored(previous => afterFailure(previous, key, error));
      } finally {
        inFlight = false;
      }
      // Only now, with the request finished, is the next one scheduled.
      scheduleNext();
    };

    // Hidden: stop the timer (a request already running may finish).
    // Visible: refresh at once, unless a request is already running, in
    // which case its completion schedules the next one.
    const onVisibilityChange = (): void => {
      if (document.hidden) {
        clearTimer();
        return;
      }
      if (!inFlight) {
        void poll();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) {
      void poll();
    }
    return () => {
      controller.abort();
      clearTimer();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [key, intervalMs, enabled, maxBackoffMs]);

  // Only a result for the current key counts; anything else is stale.
  if (stored?.key === key) {
    return stored.state;
  }
  return LOADING;
}
