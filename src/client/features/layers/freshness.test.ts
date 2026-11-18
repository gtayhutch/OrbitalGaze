/**
 * @fileoverview Tests for describing how recent a layer's data is.
 *
 * Layer: client tests.
 */
import {describe, expect, it} from 'vitest';

import {describeFreshness, formatAge} from './freshness';

const NOW = new Date('2026-11-18T12:00:00Z');

/** A time the given number of minutes before {@link NOW}. */
function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe('formatAge', () => {
  it.each([
    [-5_000, 'just now'],
    [30_000, 'just now'],
    [4 * 60_000, '4 min ago'],
    [59 * 60_000 + 59_000, '59 min ago'],
    [3 * 3_600_000 + 10 * 60_000, '3 h ago'],
    [47 * 3_600_000, '47 h ago'],
    [72 * 3_600_000, '3 days ago'],
  ])('puts an age of %i ms as "%s"', (ageMs, expected) => {
    expect(formatAge(ageMs)).toBe(expected);
  });
});

describe('describeFreshness', () => {
  it('calls data fresh up to the stale limit', () => {
    expect(
      describeFreshness({
        asOf: minutesAgo(15),
        now: NOW,
        staleAfterMs: 15 * 60_000,
      }),
    ).toEqual({state: 'fresh', age: '15 min ago'});
  });

  it('calls data stale once it is older than the limit', () => {
    expect(
      describeFreshness({
        asOf: minutesAgo(16),
        now: NOW,
        staleAfterMs: 15 * 60_000,
      }),
    ).toEqual({state: 'stale', age: '16 min ago'});
  });
});
