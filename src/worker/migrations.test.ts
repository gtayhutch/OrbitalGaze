/**
 * @fileoverview Tests that the database migrations produce the expected schema.
 *
 * Layer: worker tests (real local D1, migrated by the test setup file).
 *
 * The constraints in the migrations are the last line of defense against bad
 * data, so each important one is checked here.
 */
import {env} from 'cloudflare:workers';
import {beforeAll, describe, expect, it} from 'vitest';

/** Inserts a camera row with the given column overrides. */
async function insertCamera(
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const row = {
    id: crypto.randomUUID(),
    sourceId: 'schema-test',
    externalId: crypto.randomUUID(),
    title: 'Harbor view',
    lat: 40.7,
    lng: -74,
    category: 'city',
    ...overrides,
  };
  const columns = Object.keys(row);
  // Column names come from this test's own object keys, never from input.
  await env.DB.prepare(
    `INSERT INTO cameras (${columns.join(', ')})
     VALUES (${columns.map(() => '?').join(', ')})`,
  )
    .bind(...Object.values(row))
    .run();
}

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO sources (id, name, licenseName, attributionText)
     VALUES ('schema-test', 'Schema test', 'Test', 'Test')`,
  ).run();
});

describe('cameras table', () => {
  it('accepts a valid camera and fills in defaults', async () => {
    await insertCamera({id: 'defaults-check'});

    const row = await env.DB.prepare(
      'SELECT status, consecutiveFailures, createdAt FROM cameras WHERE id = ?',
    )
      .bind('defaults-check')
      .first<{
        status: string;
        consecutiveFailures: number;
        createdAt: string;
      }>();

    expect(row?.status).toBe('online');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects coordinates outside the valid range', async () => {
    await expect(insertCamera({lat: 91})).rejects.toThrow();
    await expect(insertCamera({lng: -181})).rejects.toThrow();
  });

  it('rejects unknown categories, statuses, and stream types', async () => {
    await expect(insertCamera({category: 'volcano-cam'})).rejects.toThrow();
    await expect(insertCamera({status: 'deleted'})).rejects.toThrow();
    await expect(insertCamera({streamType: 'rtsp'})).rejects.toThrow();
  });

  it('rejects lower-case or malformed country codes', async () => {
    await expect(insertCamera({countryCode: 'jp'})).rejects.toThrow();
    await expect(insertCamera({countryCode: 'JPN'})).rejects.toThrow();
  });

  it('keeps one row per source camera', async () => {
    await insertCamera({externalId: 'duplicate'});

    await expect(insertCamera({externalId: 'duplicate'})).rejects.toThrow();
  });

  it('requires an existing source', async () => {
    // D1 enforces foreign keys.
    await expect(insertCamera({sourceId: 'no-such-source'})).rejects.toThrow();
  });
});

describe('sources table', () => {
  it('rejects non-https homepages and invalid host lists', async () => {
    const insert = env.DB.prepare(
      `INSERT INTO sources (id, name, licenseName, attributionText, homepageUrl, allowedHosts)
       VALUES (?, 'Bad', 'Test', 'Test', ?, ?)`,
    );

    await expect(
      insert.bind('bad-url', 'http://example.com', '[]').run(),
    ).rejects.toThrow();
    await expect(
      insert.bind('bad-hosts', 'https://example.com', 'not json').run(),
    ).rejects.toThrow();
  });
});
