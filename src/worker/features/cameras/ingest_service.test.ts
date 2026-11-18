/**
 * @fileoverview Tests for the camera import service.
 *
 * Layer: worker tests (workerd with real local D1 and R2). Only Windy is
 * faked.
 *
 * Checks that importing is repeatable without duplicates, that people's
 * decisions (hiding a camera) survive re-imports, that search stays in step,
 * and that the finish step retires stale cameras and writes the index file.
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {dataEnvelope} from '@/shared/api/envelope';
import {CameraIndexSchema} from '@/shared/cameras';

import {
  buildWindyWebcam,
  fakeWindyPage,
  type FakeWindyWebcam,
} from '../../test_support/windy_fakes';
import {
  CAMERA_INDEX_OBJECT_KEY,
  finalizeImport,
  importWindyPage,
  planWindyImport,
  toDbTimestamp,
  type IngestMessage,
} from './ingest_service';
import {createCameraRepository} from './repository';
import {toFtsQuery} from './search_query';
import {createWindyClient} from './sources/windy/client';

const cameras = createCameraRepository(env.DB);

/** The message for the first page of a run. */
const firstPage: IngestMessage = {
  kind: 'windy-page',
  runId: '2026-11-18',
  offset: 0,
};

/** Imports `webcams` as one page at time `now`. */
async function importPage(
  webcams: readonly unknown[],
  now = new Date('2026-11-18T03:00:00Z'),
) {
  const windy = createWindyClient({
    apiKey: 'test-key',
    fetch: fakeWindyPage(webcams).fetch,
  });
  return importWindyPage({windy, cameras, now}, firstPage);
}

/** Counts the search entries for one camera. */
async function searchEntryCount(cameraId: string): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT count(*) AS n FROM cameras_fts WHERE cameraId = ?',
  )
    .bind(cameraId)
    .first<{n: number}>();
  return row?.n ?? 0;
}

/** Reads one stored camera's status and last-seen time. */
async function storedCamera(id: string) {
  return env.DB.prepare(
    'SELECT status, lastSeenAt, title FROM cameras WHERE id = ?',
  )
    .bind(id)
    .first<{status: string; lastSeenAt: string | null; title: string}>();
}

/** The camera ID the adapter gives a webcam. */
function idOf(webcam: FakeWindyWebcam): string {
  return `windy-${webcam.webcamId}`;
}

describe('planWindyImport', () => {
  it('plans 200 pages of 50, covering the top 10,000, under one run ID', () => {
    const messages = planWindyImport(new Date('2026-11-18T03:00:00Z'));

    expect(messages).toHaveLength(200);
    expect(messages[0]).toEqual({
      kind: 'windy-page',
      runId: '2026-11-18',
      offset: 0,
    });
    expect(messages.at(-1)?.offset).toBe(9_950);
  });
});

describe('importWindyPage', () => {
  it('creates the source and the cameras, stamped as seen', async () => {
    const webcam = buildWindyWebcam();

    const result = await importPage([webcam]);

    expect(result).toEqual({imported: 1, created: 1, skipped: 0});
    const stored = await storedCamera(idOf(webcam));
    expect(stored?.status).toBe('online');
    expect(stored?.lastSeenAt).toBe('2026-11-18T03:00:00Z');
    const detail = await cameras.findPublicById(idOf(webcam));
    expect(detail?.attribution.attributionText).toBe(
      'Webcams provided by windy.com',
    );
  });

  it('can run twice without duplicating cameras or search entries', async () => {
    const webcam = buildWindyWebcam();

    await importPage([webcam]);
    const second = await importPage([webcam], new Date('2026-11-19T03:00:00Z'));

    expect(second.created).toBe(0);
    expect(await searchEntryCount(idOf(webcam))).toBe(1);
    expect((await storedCamera(idOf(webcam)))?.lastSeenAt).toBe(
      '2026-11-19T03:00:00Z',
    );
  });

  it('keeps one entry when Windy lists the same webcam twice on a page', async () => {
    const webcam = buildWindyWebcam();

    const result = await importPage([webcam, webcam]);

    expect(result.imported).toBe(1);
    expect(await searchEntryCount(idOf(webcam))).toBe(1);
  });

  it('updates search when a title changes', async () => {
    const webcam = buildWindyWebcam({title: 'Old harbor name'});
    await importPage([webcam]);

    await importPage([{...webcam, title: 'Kittiwake lighthouse'}]);

    const ftsQuery = toFtsQuery('Kittiwake');
    expect(ftsQuery).not.toBeNull();
    const hits = await cameras.searchByText(ftsQuery ?? '', 5);
    expect(hits.map(hit => hit.id)).toEqual([idOf(webcam)]);
    expect(await searchEntryCount(idOf(webcam))).toBe(1);
  });

  it('keeps a hidden camera hidden when Windy lists it again', async () => {
    const webcam = buildWindyWebcam();
    await importPage([webcam]);
    await env.DB.prepare("UPDATE cameras SET status = 'hidden' WHERE id = ?")
      .bind(idOf(webcam))
      .run();

    await importPage([webcam]);

    expect((await storedCamera(idOf(webcam)))?.status).toBe('hidden');
  });

  it('counts webcams that fail validation without storing them', async () => {
    const result = await importPage([{webcamId: -1}, buildWindyWebcam()]);

    expect(result).toMatchObject({imported: 1, skipped: 1});
  });
});

describe('finalizeImport', () => {
  it('marks only stale imported cameras offline and writes the index file', async () => {
    const stale = buildWindyWebcam();
    const fresh = buildWindyWebcam();
    await importPage([stale], new Date('2026-11-20T03:00:00Z'));
    await importPage([fresh], new Date('2026-11-23T03:00:00Z'));

    const result = await finalizeImport({
      cameras,
      bucket: env.CAMERA_INDEX,
      now: new Date('2026-11-23T03:30:00Z'),
    });

    expect(result.markedOffline).toBeGreaterThanOrEqual(1);
    expect(result.indexWritten).toBe(true);
    expect((await storedCamera(idOf(stale)))?.status).toBe('offline');
    expect((await storedCamera(idOf(fresh)))?.status).toBe('online');

    const object = await env.CAMERA_INDEX.get(CAMERA_INDEX_OBJECT_KEY);
    expect(object?.httpMetadata?.contentType).toBe(
      'application/json; charset=UTF-8',
    );
    const {data} = dataEnvelope(CameraIndexSchema).parse(await object?.json());
    const ids = data.cameras.map(entry => entry.id);
    expect(ids).toContain(idOf(fresh));
    expect(ids).not.toContain(idOf(stale));
    expect(data.generatedAt).toBe('2026-11-23T03:30:00.000Z');
  });

  it('skips rewriting the index file when the pins have not changed', async () => {
    const now = new Date('2026-11-23T04:30:00Z');
    await finalizeImport({cameras, bucket: env.CAMERA_INDEX, now});

    const again = await finalizeImport({
      cameras,
      bucket: env.CAMERA_INDEX,
      now,
    });

    expect(again.indexWritten).toBe(false);
  });

  it('never sweeps cameras that were not imported', async () => {
    await env.DB.prepare(
      `INSERT INTO sources (id, name, licenseName, attributionText)
       VALUES ('manual', 'Manual', 'Test', 'Test')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cameras (id, sourceId, externalId, title, lat, lng, category)
       VALUES ('manual-1', 'manual', 'm1', 'Hand-added camera', 0, 0, 'city')`,
    ).run();

    await finalizeImport({
      cameras,
      bucket: env.CAMERA_INDEX,
      now: new Date('2030-01-01T00:00:00Z'),
    });

    expect((await storedCamera('manual-1'))?.status).toBe('online');
  });
});

describe('toDbTimestamp', () => {
  it('formats times the way the database stores them', () => {
    expect(toDbTimestamp(new Date('2026-11-18T03:00:00.123Z'))).toBe(
      '2026-11-18T03:00:00Z',
    );
  });
});
