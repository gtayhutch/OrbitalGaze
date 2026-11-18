/**
 * @fileoverview How recent a layer's data is, in words.
 *
 * Layer: client feature (browser only). Pure functions; the current time is
 * passed in so results are predictable and testable.
 *
 * Every layer says when its data was last updated ("Updated 4 min ago"), and
 * flags data that is older than the layer expects as stale. The state is
 * always given in words as well as colour, so it doesn't depend on seeing
 * colour.
 */

/** One minute, in milliseconds. */
const MINUTE_MS = 60_000;

/** One hour, in milliseconds. */
const HOUR_MS = 60 * MINUTE_MS;

/** Up to this age, ages are given in hours; beyond it, in days. */
const HOURS_LIMIT_MS = 48 * HOUR_MS;

/** Whether data is as recent as its layer expects. */
export type FreshnessState = 'fresh' | 'stale';

/** What the freshness chip shows. */
export interface Freshness {
  /** "fresh" or "stale". */
  readonly state: FreshnessState;
  /** The data's age in words, for example "4 min ago" or "just now". */
  readonly age: string;
}

/** Inputs for {@link describeFreshness}. */
export interface FreshnessInput {
  /** When the data was last updated. */
  readonly asOf: Date;
  /** The current time. */
  readonly now: Date;
  /** Data older than this is stale. */
  readonly staleAfterMs: number;
}

/**
 * Puts an age into short words.
 *
 * @param ageMs The age in milliseconds. Negative ages (a clock slightly
 *     ahead of ours) count as "just now".
 * @returns "just now", "N min ago", "N h ago", or "N days ago".
 * @example
 * formatAge(4 * 60_000); // "4 min ago"
 */
export function formatAge(ageMs: number): string {
  if (ageMs < MINUTE_MS) {
    return 'just now';
  }
  if (ageMs < HOUR_MS) {
    return `${Math.floor(ageMs / MINUTE_MS)} min ago`;
  }
  if (ageMs < HOURS_LIMIT_MS) {
    return `${Math.floor(ageMs / HOUR_MS)} h ago`;
  }
  return `${Math.floor(ageMs / (24 * HOUR_MS))} days ago`;
}

/**
 * Describes how recent a layer's data is.
 *
 * @param input When the data is from, the current time, and the age at which
 *     it counts as stale.
 * @returns The state and the age in words.
 * @example
 * describeFreshness({asOf, now, staleAfterMs: 15 * 60_000});
 * // {state: 'fresh', age: '4 min ago'}
 */
export function describeFreshness(input: FreshnessInput): Freshness {
  const ageMs = input.now.getTime() - input.asOf.getTime();
  return {
    state: ageMs > input.staleAfterMs ? 'stale' : 'fresh',
    age: formatAge(ageMs),
  };
}
