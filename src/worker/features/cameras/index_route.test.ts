/**
 * @fileoverview Tests that the camera index route prefers the prebuilt file.
 *
 * Layer: worker tests (workerd with real local D1, R2, and cache).
 *
 * Kept apart from `routes.test.ts` because the index is cached at the edge:
 * each test file gets fresh storage, so this file's first request is
 * guaranteed to miss the cache and read R2.
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {dataEnvelope} from '@/shared/api/envelope';
import {CameraIndexSchema, type CameraIndex} from '@/shared/cameras';

import {seedCameras} from '../../test_support/factories';
import {getPath} from '../../test_support/send_request';
import {CAMERA_INDEX_OBJECT_KEY} from './ingest_service';

describe('GET /api/v1/cameras/index with an index file', () => {
  it('serves the file from R2 rather than querying the database', async () => {
    // The database has a camera the file doesn't, so the source is visible.
    await seedCameras([{id: 'database-only'}]);
    const prebuilt: CameraIndex = {
      generatedAt: '2026-11-18T03:30:00.000Z',
      cameras: [{id: 'windy-1', lat: 46.02, lng: 7.75, category: 'nature'}],
    };
    await env.CAMERA_INDEX.put(
      CAMERA_INDEX_OBJECT_KEY,
      JSON.stringify({data: prebuilt}),
    );

    const response = await getPath('/api/v1/cameras/index');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    const {data} = dataEnvelope(CameraIndexSchema).parse(await response.json());
    expect(data).toEqual(prebuilt);
  });
});
