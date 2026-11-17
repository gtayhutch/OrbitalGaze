/**
 * @fileoverview Integration tests for the camera API routes.
 *
 * Layer: worker tests (workerd with a real, migrated local D1).
 *
 * Covers what each route returns, who can see what (hidden cameras are never
 * revealed), that the feed location never leaves the server, input
 * validation, and search safety.
 */
import {beforeAll, describe, expect, it} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';
import {dataEnvelope} from '@/shared/api/envelope';
import {
  CameraDetailSchema,
  CameraIndexSchema,
  CameraSearchResponseSchema,
  type CameraIndexEntry,
} from '@/shared/cameras';

import {seedCameras} from '../../test_support/factories';
import {getPath} from '../../test_support/send_request';
import type {NewCamera} from './repository';

/** A recognizable feed location that must never appear in a response. */
const SECRET_FEED_URL = 'https://images.example.com/private-feed.jpg';

let online: NewCamera;
let offline: NewCamera;
let hidden: NewCamera;
let withFeed: NewCamera;

beforeAll(async () => {
  const {cameras} = await seedCameras([
    {title: 'Tokyo Tower view', placeName: 'Tokyo', category: 'landmark'},
    {title: 'Shibuya crossing', placeName: 'Tokyo', status: 'offline'},
    {title: 'Tokyo secret cam', placeName: 'Tokyo', status: 'hidden'},
    {
      title: 'Harbor with feed',
      placeName: 'Sydney',
      countryCode: 'AU',
      streamType: 'snapshot',
      streamRef: SECRET_FEED_URL,
    },
  ]);
  [online, offline, hidden, withFeed] = cameras as [
    NewCamera,
    NewCamera,
    NewCamera,
    NewCamera,
  ];
});

/** Reads an error response's code. */
async function errorCode(response: Response): Promise<string> {
  return ApiErrorResponseSchema.parse(await response.json()).error.code;
}

describe('GET /api/v1/cameras/index', () => {
  it('lists only online cameras, with pin data only', async () => {
    const response = await getPath('/api/v1/cameras/index');

    expect(response.status).toBe(200);
    const {data} = dataEnvelope(CameraIndexSchema).parse(await response.json());
    const ids = data.cameras.map((entry: CameraIndexEntry) => entry.id);
    expect(ids).toContain(online.id);
    expect(ids).toContain(withFeed.id);
    expect(ids).not.toContain(offline.id);
    expect(ids).not.toContain(hidden.id);
    expect(Object.keys(data.cameras[0] ?? {}).sort()).toEqual([
      'category',
      'id',
      'lat',
      'lng',
    ]);
  });

  it('can be cached publicly for five minutes', async () => {
    const response = await getPath('/api/v1/cameras/index');

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
  });
});

describe('GET /api/v1/cameras/:id', () => {
  it('returns an online camera with its attribution', async () => {
    const response = await getPath(`/api/v1/cameras/${online.id}`);

    expect(response.status).toBe(200);
    const {data} = dataEnvelope(CameraDetailSchema).parse(
      await response.json(),
    );
    expect(data).toMatchObject({
      id: online.id,
      title: 'Tokyo Tower view',
      status: 'online',
      hasFeed: false,
      timeZone: 'Asia/Tokyo',
    });
    expect(data.attribution.attributionText).toBe(
      'Courtesy of the test source',
    );
  });

  it('returns an offline camera, marked offline', async () => {
    const response = await getPath(`/api/v1/cameras/${offline.id}`);

    const {data} = dataEnvelope(CameraDetailSchema).parse(
      await response.json(),
    );
    expect(data.status).toBe('offline');
  });

  it('answers 404 for a hidden camera, the same as for an unknown one', async () => {
    const hiddenResponse = await getPath(`/api/v1/cameras/${hidden.id}`);
    const unknownResponse = await getPath('/api/v1/cameras/does-not-exist');

    expect(hiddenResponse.status).toBe(404);
    expect(unknownResponse.status).toBe(404);
    expect(await errorCode(hiddenResponse)).toBe('NOT_FOUND');
    expect(await errorCode(unknownResponse)).toBe('NOT_FOUND');
  });

  it('reports that a feed exists without revealing where it is', async () => {
    const response = await getPath(`/api/v1/cameras/${withFeed.id}`);
    const text = await response.text();

    expect(text).not.toContain(SECRET_FEED_URL);
    expect(text).not.toContain('streamRef');
    const {data} = dataEnvelope(CameraDetailSchema).parse(JSON.parse(text));
    expect(data.hasFeed).toBe(true);
  });

  it('rejects an ID with characters outside the allowed set', async () => {
    const response = await getPath("/api/v1/cameras/abc'%20OR%201=1");

    expect(response.status).toBe(400);
    const body = ApiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.fieldErrors?.['id']).toBeDefined();
  });
});

describe('GET /api/v1/cameras/search', () => {
  /** Runs a search and returns the result IDs. */
  async function searchIds(query: string): Promise<string[]> {
    const response = await getPath(
      `/api/v1/cameras/search?q=${encodeURIComponent(query)}`,
    );
    expect(response.status).toBe(200);
    const {data} = dataEnvelope(CameraSearchResponseSchema).parse(
      await response.json(),
    );
    return data.results.map(result => result.id);
  }

  it('finds cameras by place, including offline ones but never hidden ones', async () => {
    const ids = await searchIds('tokyo');

    expect(ids).toContain(online.id);
    expect(ids).toContain(offline.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('matches partial words as the visitor types', async () => {
    expect(await searchIds('syd')).toEqual([withFeed.id]);
  });

  it('treats search syntax as plain text', async () => {
    // Would match everything (or fail) if passed to FTS5 unescaped.
    expect(await searchIds('tokyo OR harbor')).toEqual([]);
    expect(await searchIds('"tower" NEAR(title:*)')).toEqual([]);
  });

  it('rejects empty, punctuation-only, and over-long queries', async () => {
    const empty = await getPath('/api/v1/cameras/search?q=%20');
    const punctuation = await getPath('/api/v1/cameras/search?q=***');
    const tooLong = await getPath(
      `/api/v1/cameras/search?q=${'a'.repeat(101)}`,
    );
    const missing = await getPath('/api/v1/cameras/search');

    for (const response of [empty, punctuation, tooLong, missing]) {
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe('INVALID_INPUT');
    }
  });
});
