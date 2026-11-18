/**
 * @fileoverview Tests for the polling hook.
 *
 * Layer: client tests (jsdom). Timers are fake, so intervals and backoff are
 * checked by advancing the clock instead of waiting. Tab visibility is
 * simulated by overriding `document.hidden` and firing `visibilitychange`.
 */
import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {nextPollDelayMs, usePolling, type PollingOptions} from './use_polling';

/** The interval most tests use, in milliseconds. */
const INTERVAL_MS = 1_000;

/** Whether the simulated tab is hidden. */
let tabHidden = false;

/** Hides or shows the simulated tab and tells listeners, like a browser. */
function setTabHidden(hidden: boolean): void {
  tabHidden = hidden;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Advances fake time and lets resolved promises and React updates settle. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** A promise the test resolves or rejects by hand. */
interface Deferred<Value> {
  readonly promise: Promise<Value>;
  resolve(value: Value): void;
  reject(error: Error): void;
}

/** Creates a {@link Deferred}. */
function deferred<Value>(): Deferred<Value> {
  let resolve: (value: Value) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return {promise, resolve, reject};
}

/** Renders the hook with `load` and options (defaults: key `a`, 1 s). */
function renderPolling<Data>(
  load: (signal: AbortSignal) => Promise<Data>,
  options: Partial<PollingOptions> = {},
) {
  return renderHook((props: PollingOptions) => usePolling(load, props), {
    initialProps: {key: 'a', intervalMs: INTERVAL_MS, ...options},
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  tabHidden = false;
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => tabHidden,
  });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'hidden');
});

describe('nextPollDelayMs', () => {
  it('waits one interval after a success', () => {
    expect(nextPollDelayMs(1_000, 0, 60_000)).toBe(1_000);
  });

  it('doubles the wait for each failure in a row', () => {
    expect(nextPollDelayMs(1_000, 1, 60_000)).toBe(2_000);
    expect(nextPollDelayMs(1_000, 2, 60_000)).toBe(4_000);
    expect(nextPollDelayMs(1_000, 3, 60_000)).toBe(8_000);
  });

  it('never waits longer than the cap', () => {
    expect(nextPollDelayMs(1_000, 10, 5_000)).toBe(5_000);
    expect(nextPollDelayMs(1_000, 2_000, 5_000)).toBe(5_000);
  });

  it('never waits less than the interval, even with a smaller cap', () => {
    expect(nextPollDelayMs(10_000, 3, 5_000)).toBe(10_000);
  });
});

describe('usePolling', () => {
  it('loads at once, then again one interval after each success', async () => {
    const load = vi.fn(() => Promise.resolve('data'));
    const {result} = renderPolling(load);
    await advance(0);

    expect(result.current).toEqual({
      status: 'ready',
      data: 'data',
      lastAttemptFailed: false,
    });
    expect(load).toHaveBeenCalledTimes(1);

    await advance(INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('never starts a request while one is still running', async () => {
    const slow = deferred<string>();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue('later');
    renderPolling(load);

    // Five intervals pass while the first request is still open.
    await advance(5 * INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);

    // The next request is scheduled only once the first one finishes.
    slow.resolve('first');
    await advance(INTERVAL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good data when a refresh fails', async () => {
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('good')
      .mockRejectedValue(new Error('offline'));
    const {result} = renderPolling(load);
    await advance(0);

    await advance(INTERVAL_MS);

    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({
      status: 'ready',
      data: 'good',
      lastAttemptFailed: true,
    });
  });

  it('reports an error when nothing has loaded yet', async () => {
    const failure = new Error('offline');
    const {result} = renderPolling(() => Promise.reject(failure));
    await advance(0);

    expect(result.current).toEqual({status: 'error', error: failure});
  });

  it('doubles the wait after each failure, up to the cap', async () => {
    const load = vi.fn(() => Promise.reject(new Error('offline')));
    renderPolling(load, {maxBackoffMs: 5 * INTERVAL_MS});
    await advance(0);
    expect(load).toHaveBeenCalledTimes(1);

    // Waits after failures 1, 2, 3, and 4: 2 s, 4 s, then the 5 s cap.
    for (const [waitMs, calls] of [
      [2_000, 2],
      [4_000, 3],
      [5_000, 4],
      [5_000, 5],
    ] as const) {
      await advance(waitMs - 1);
      expect(load).toHaveBeenCalledTimes(calls - 1);
      await advance(1);
      expect(load).toHaveBeenCalledTimes(calls);
    }
  });

  it('returns to the normal interval after a success', async () => {
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('back');
    renderPolling(load);
    await advance(0);

    await advance(2 * INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);

    await advance(INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('pauses while the tab is hidden and refreshes when it is shown', async () => {
    const load = vi.fn(() => Promise.resolve('data'));
    renderPolling(load);
    await advance(0);

    act(() => {
      setTabHidden(true);
    });
    await advance(10 * INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(1);

    act(() => {
      setTabHidden(false);
    });
    await advance(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not start a second request when the tab is shown mid-request', async () => {
    const slow = deferred<string>();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue('later');
    renderPolling(load);

    act(() => {
      setTabHidden(true);
      setTabHidden(false);
    });
    await advance(0);
    expect(load).toHaveBeenCalledTimes(1);

    // Once the open request finishes, polling carries on as normal.
    slow.resolve('first');
    await advance(INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('waits for the tab to be shown before the first request', async () => {
    tabHidden = true;
    const load = vi.fn(() => Promise.resolve('data'));
    const {result} = renderPolling(load);
    await advance(10 * INTERVAL_MS);

    expect(load).not.toHaveBeenCalled();
    expect(result.current).toEqual({status: 'loading'});

    act(() => {
      setTabHidden(false);
    });
    await advance(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('aborts the request and stops on unmount', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return deferred<string>().promise;
    });
    const {unmount} = renderPolling(load);

    unmount();
    await advance(10 * INTERVAL_MS);

    expect(signals[0]?.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('aborts the request and stops when disabled', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return Promise.resolve('data');
    });
    const {rerender} = renderPolling(load);
    await advance(0);

    rerender({key: 'a', intervalMs: INTERVAL_MS, enabled: false});
    await advance(10 * INTERVAL_MS);

    expect(signals[0]?.aborted).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('starts over with no data when the key changes', async () => {
    const pending = deferred<string>();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockResolvedValueOnce('for a')
      .mockReturnValueOnce(pending.promise);
    const {result, rerender} = renderPolling(load);
    await advance(0);

    rerender({key: 'b', intervalMs: INTERVAL_MS});
    await advance(0);

    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({status: 'loading'});
  });
});
