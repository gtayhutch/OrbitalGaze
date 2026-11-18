/**
 * @fileoverview Tests for the layer snapshot hook.
 *
 * Layer: client tests (jsdom). The API is stubbed with canned responses
 * (`fake_api.ts`) and timers are fake, so refreshes are driven by advancing
 * the clock. Polling details (overlap, backoff, hidden tabs) are covered in
 * `use_polling.test.ts`; these tests cover the layer contract.
 */
import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';

import {apiError, ok, stubApi} from '@/client/test_support/fake_api';

import {layerSnapshotPath, useLayerSnapshot} from './use_layer_snapshot';

/** Item shape of the test layer. */
const PointSchema = z.object({id: z.string(), lat: z.number()});

/** The test layer's ID and path. */
const LAYER_ID = 'test-points';
const LAYER_PATH = '/api/v1/layers/test-points';

/** The test layer's refresh interval, in milliseconds. */
const INTERVAL_MS = 60_000;

/** A snapshot of the test layer. */
const SNAPSHOT = {
  layerId: LAYER_ID,
  checkedAt: '2026-11-18T10:05:00.000Z',
  items: [{id: 'a', lat: 1.5}],
};

/** Lets the stubbed request resolve and React update. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Renders the hook for the test layer. */
function renderLayer() {
  return renderHook(() => useLayerSnapshot(LAYER_ID, PointSchema, INTERVAL_MS));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Failures are logged on purpose; keep test output clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('layerSnapshotPath', () => {
  it('builds the API path for a layer', () => {
    expect(layerSnapshotPath('earthquakes')).toBe('/api/v1/layers/earthquakes');
  });
});

describe('useLayerSnapshot', () => {
  it('starts in the loading state', () => {
    stubApi({[LAYER_PATH]: ok(SNAPSHOT)});

    const {result} = renderLayer();

    expect(result.current).toEqual({status: 'loading'});
  });

  it('returns the items and when they were checked', async () => {
    const fetchStub = stubApi({[LAYER_PATH]: ok(SNAPSHOT)});

    const {result} = renderLayer();
    await advance(0);

    expect(result.current).toEqual({
      status: 'ready',
      items: SNAPSHOT.items,
      checkedAt: '2026-11-18T10:05:00.000Z',
      refreshFailed: false,
    });
    expect(fetchStub).toHaveBeenCalledWith(LAYER_PATH, expect.anything());
  });

  it('asks again after the interval', async () => {
    const fetchStub = stubApi({[LAYER_PATH]: ok(SNAPSHOT)});
    renderLayer();
    await advance(0);

    await advance(INTERVAL_MS);

    expect(fetchStub).toHaveBeenCalledTimes(2);
  });

  it('reports an error when the layer is not available', async () => {
    stubApi({[LAYER_PATH]: apiError(404, 'NOT_FOUND')});

    const {result} = renderLayer();
    await advance(0);

    expect(result.current).toEqual({status: 'error'});
  });

  it('rejects items that do not match the layer schema', async () => {
    stubApi({
      [LAYER_PATH]: ok({...SNAPSHOT, items: [{id: 'a', lat: 'north'}]}),
    });

    const {result} = renderLayer();
    await advance(0);

    expect(result.current).toEqual({status: 'error'});
  });

  it('rejects a snapshot for a different layer', async () => {
    stubApi({[LAYER_PATH]: ok({...SNAPSHOT, layerId: 'other-layer'})});

    const {result} = renderLayer();
    await advance(0);

    expect(result.current).toEqual({status: 'error'});
  });

  it('keeps showing the last items when a refresh fails', async () => {
    stubApi({[LAYER_PATH]: ok(SNAPSHOT)});
    const {result} = renderLayer();
    await advance(0);

    stubApi({[LAYER_PATH]: apiError(500, 'INTERNAL')});
    await advance(INTERVAL_MS);

    expect(result.current).toEqual({
      status: 'ready',
      items: SNAPSHOT.items,
      checkedAt: '2026-11-18T10:05:00.000Z',
      refreshFailed: true,
    });
  });
});
