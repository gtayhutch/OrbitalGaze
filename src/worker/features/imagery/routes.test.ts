/**
 * @fileoverview Tests for the imagery tile route (satellite map style).
 *
 * Layer: worker tests (workerd, real Cache API). GIBS is replaced by a fake
 * `fetch`, so no test reaches NASA.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';

import {getPath} from '../../test_support/send_request';
import {blueMarbleTileUrl, IMAGERY_MAX_AGE_SECONDS} from './routes';

/** A tiny stand-in JPEG body. */
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(() =>
      Promise.resolve(
        new Response(JPEG, {headers: {'Content-Type': 'image/jpeg'}}),
      ),
    );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The upstream URLs requested during the test. */
function upstreamUrls(): URL[] {
  return fetchSpy.mock.calls.map(
    ([input]) => new URL(input instanceof Request ? input.url : String(input)),
  );
}

describe('GET /api/v1/imagery/bluemarble/:z/:x/:y.jpg', () => {
  it('serves a tile from GIBS, cacheable for 30 days', async () => {
    const response = await getPath('/api/v1/imagery/bluemarble/2/1/3.jpg');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe(
      `public, max-age=${String(IMAGERY_MAX_AGE_SECONDS)}`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    // GIBS orders the path z / row (y) / column (x).
    expect(upstreamUrls().map(url => url.toString())).toEqual([
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/default/GoogleMapsCompatible_Level8/2/3/1.jpg',
    ]);
  });

  it('serves the cached copy without asking GIBS again', async () => {
    await getPath('/api/v1/imagery/bluemarble/3/5/6.jpg');
    // The first response's cache write runs after it returns.
    await vi.waitFor(async () => {
      fetchSpy.mockClear();
      const again = await getPath('/api/v1/imagery/bluemarble/3/5/6.jpg');
      expect(again.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it.each([
    ['a zoom past the mosaic', '/api/v1/imagery/bluemarble/9/0/0.jpg'],
    ['a column outside the grid', '/api/v1/imagery/bluemarble/1/2/0.jpg'],
    ['a row outside the grid', '/api/v1/imagery/bluemarble/1/0/2.jpg'],
    ['a non-numeric coordinate', '/api/v1/imagery/bluemarble/1/a/0.jpg'],
    ['another file type', '/api/v1/imagery/bluemarble/1/0/0.png'],
  ])('refuses %s with 400 before calling GIBS', async (_label, path) => {
    const response = await getPath(path);

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answers 500 with a plain message when GIBS fails', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response('<error/>', {
          status: 200,
          headers: {'Content-Type': 'text/xml'},
        }),
      ),
    );

    const response = await getPath('/api/v1/imagery/bluemarble/4/7/7.jpg');

    expect(response.status).toBe(500);
    const body = ApiErrorResponseSchema.parse(await response.json());
    expect(body.error.message).toBe(
      'Satellite imagery is temporarily unavailable.',
    );
  });
});

describe('blueMarbleTileUrl', () => {
  it('builds the GIBS URL from the three numbers only', () => {
    expect(blueMarbleTileUrl({z: 0, x: 0, y: 0}).hostname).toBe(
      'gibs.earthdata.nasa.gov',
    );
  });
});
