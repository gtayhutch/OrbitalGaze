/**
 * @fileoverview Tests for the shared layer schemas.
 *
 * Layer: shared tests (pure; run in the worker test project).
 */
import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {
  LayerIdSchema,
  layerSnapshotSchema,
  MAX_LAYER_SNAPSHOT_ITEMS,
} from './layers';

/** A minimal item shape for the tests. */
const PointSchema = z.object({id: z.string(), lat: z.number()});

/** The snapshot schema for {@link PointSchema} items. */
const PointSnapshotSchema = layerSnapshotSchema(PointSchema);

describe('LayerIdSchema', () => {
  it('accepts lowercase IDs with digits and hyphens', () => {
    for (const id of ['earthquakes', 'us-weather-alerts', 'a', 'aurora2']) {
      expect(LayerIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('rejects IDs that are empty, too long, or contain other characters', () => {
    for (const id of [
      '',
      'Earthquakes',
      '2fast',
      '-leading',
      'has space',
      'dots.not.allowed',
      '../escape',
      'a'.repeat(41),
    ]) {
      expect(LayerIdSchema.safeParse(id).success).toBe(false);
    }
  });
});

describe('layerSnapshotSchema', () => {
  it('accepts a snapshot whose items match the item schema', () => {
    const snapshot = {
      layerId: 'test-points',
      checkedAt: '2026-11-18T10:05:00.000Z',
      items: [{id: 'a', lat: 1.5}],
    };

    expect(PointSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('rejects an item that does not match', () => {
    const result = PointSnapshotSchema.safeParse({
      layerId: 'test-points',
      checkedAt: '2026-11-18T10:05:00.000Z',
      items: [{id: 'a', lat: 'north'}],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a checked time that is not an ISO 8601 UTC timestamp', () => {
    const result = PointSnapshotSchema.safeParse({
      layerId: 'test-points',
      checkedAt: 'yesterday',
      items: [],
    });

    expect(result.success).toBe(false);
  });

  it('rejects more items than the cap', () => {
    const result = layerSnapshotSchema(z.unknown()).safeParse({
      layerId: 'test-points',
      checkedAt: '2026-11-18T10:05:00.000Z',
      items: new Array<null>(MAX_LAYER_SNAPSHOT_ITEMS + 1).fill(null),
    });

    expect(result.success).toBe(false);
  });
});
