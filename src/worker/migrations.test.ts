/**
 * @fileoverview Tests that the database migrations produce the expected schema.
 *
 * Layer: worker tests (real local D1, migrated by the test setup file).
 */
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

describe('cameras table', () => {
  it('accepts a valid camera and fills in defaults', async () => {
    await env.DB.prepare(
      'INSERT INTO cameras (id, name, latitude, longitude, category) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('camera-1', 'Harbor view', 40.7, -74.0, 'city')
      .run();

    const row = await env.DB.prepare(
      'SELECT status, created_at FROM cameras WHERE id = ?',
    )
      .bind('camera-1')
      .first<{status: string; created_at: string}>();

    expect(row?.status).toBe('active');
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('rejects coordinates outside the valid range', async () => {
    const insert = env.DB.prepare(
      'INSERT INTO cameras (id, name, latitude, longitude, category) VALUES (?, ?, ?, ?, ?)',
    );

    await expect(
      insert.bind('bad-lat', 'Bad', 91, 0, 'city').run(),
    ).rejects.toThrow();
    await expect(
      insert.bind('bad-lng', 'Bad', 0, 181, 'city').run(),
    ).rejects.toThrow();
  });

  it('rejects an unknown category', async () => {
    await expect(
      env.DB.prepare(
        'INSERT INTO cameras (id, name, latitude, longitude, category) VALUES (?, ?, ?, ?, ?)',
      )
        .bind('bad-category', 'Bad', 0, 0, 'volcano-cam')
        .run(),
    ).rejects.toThrow();
  });
});
