/**
 * @fileoverview Checks every registered snapshot layer follows the rules.
 *
 * Layer: worker tests (pure checks over `SNAPSHOT_SOURCES`).
 *
 * The registry is empty until the first layer arrives; these tests then
 * guard each new entry: a bad ID, an interval the 5-minute cron can't keep,
 * or a duplicate would otherwise only show up in production logs.
 */
import {describe, expect, it} from 'vitest';

import {LayerIdSchema} from '@/shared/layers';

import {SNAPSHOT_SOURCES} from './registry';
import {isValidRefreshMinutes} from './snapshot_source';

describe('SNAPSHOT_SOURCES', () => {
  it('uses unique, well-formed layer IDs', () => {
    const ids = SNAPSHOT_SOURCES.map(source => source.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(LayerIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('uses refresh intervals the 5-minute cron can keep', () => {
    for (const source of SNAPSHOT_SOURCES) {
      expect(isValidRefreshMinutes(source.refreshMinutes)).toBe(true);
    }
  });

  it('uses a positive whole number of seconds as the cache lifetime', () => {
    for (const source of SNAPSHOT_SOURCES) {
      expect(Number.isInteger(source.maxAgeSeconds)).toBe(true);
      expect(source.maxAgeSeconds).toBeGreaterThan(0);
    }
  });
});

describe('isValidRefreshMinutes', () => {
  it.each([5, 10, 15, 30, 60, 240, 1440])('accepts %i minutes', minutes => {
    expect(isValidRefreshMinutes(minutes)).toBe(true);
  });

  it.each([0, -5, 3, 7.5, 35, 2880])('rejects %d minutes', minutes => {
    // 3 and 7.5 miss the 5-minute cron; 35 leaves an uneven gap at midnight;
    // 2880 is longer than a day.
    expect(isValidRefreshMinutes(minutes)).toBe(false);
  });
});
