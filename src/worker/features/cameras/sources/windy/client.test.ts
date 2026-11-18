/**
 * @fileoverview Tests for the Windy API client.
 *
 * Layer: worker tests (workerd). Windy is replaced by a fake `fetch`.
 */
import {describe, expect, it} from 'vitest';

import {
  buildWindyWebcam,
  fakeFetch,
  fakeWindyPage,
  jsonResponse,
} from '../../../../test_support/windy_fakes';
import {OutboundError} from '../../../../lib/outbound_fetch';
import {createWindyClient, isWindyKeyRejected} from './client';

describe('createWindyClient().listPopularWebcams', () => {
  it('asks Windy for one popularity-ranked page, sending the key only in a header', async () => {
    const fake = fakeWindyPage([buildWindyWebcam()]);
    const windy = createWindyClient({apiKey: 'test-key', fetch: fake.fetch});

    await windy.listPopularWebcams({offset: 100, limit: 50});

    const request = fake.requests[0];
    expect(request?.url.origin).toBe('https://api.windy.com');
    expect(request?.url.pathname).toBe('/webcams/api/v3/webcams');
    expect(Object.fromEntries(request?.url.searchParams ?? [])).toEqual({
      offset: '100',
      limit: '50',
      sortKey: 'popularity',
      sortDirection: 'desc',
      include: 'categories,location',
      lang: 'en',
    });
    expect(request?.headers.get('x-windy-api-key')).toBe('test-key');
    expect(request?.url.toString()).not.toContain('test-key');
  });

  it('drops malformed webcams and counts them, keeping the valid ones', async () => {
    const valid = buildWindyWebcam();
    const fake = fakeWindyPage([
      valid,
      {webcamId: 'not-a-number', title: 'Bad'},
      buildWindyWebcam({location: {latitude: 200, longitude: 0}}),
    ]);
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    const page = await windy.listPopularWebcams({offset: 0, limit: 50});

    expect(page.webcams.map(webcam => webcam.webcamId)).toEqual([
      valid.webcamId,
    ]);
    expect(page.skipped).toBe(2);
    expect(page.total).toBe(10_000);
  });

  it('rejects a page that is not shaped like a list', async () => {
    const fake = fakeFetch(() => jsonResponse({unexpected: true}));
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    await expect(
      windy.listPopularWebcams({offset: 0, limit: 50}),
    ).rejects.toBeInstanceOf(OutboundError);
  });

  it('refuses page sizes Windy does not support', async () => {
    const fake = fakeWindyPage([]);
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    await expect(
      windy.listPopularWebcams({offset: 0, limit: 51}),
    ).rejects.toBeInstanceOf(RangeError);
    expect(fake.requests).toHaveLength(0);
  });
});

describe('createWindyClient().getWebcamFeed', () => {
  it('asks for one webcam with its images, players, and page link', async () => {
    const fake = fakeFetch(() =>
      jsonResponse({
        webcamId: 42,
        status: 'active',
        player: {day: {embed: 'https://webcams.windy.com/embed/42/day'}},
      }),
    );
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    const webcam = await windy.getWebcamFeed('42');

    expect(fake.requests[0]?.url.pathname).toBe('/webcams/api/v3/webcams/42');
    expect(fake.requests[0]?.url.searchParams.get('include')).toBe(
      'images,player,urls',
    );
    // The older `{embed}` player shape is reduced to the link.
    expect(webcam?.player?.day).toBe('https://webcams.windy.com/embed/42/day');
  });

  it('returns null when Windy does not know the webcam', async () => {
    const fake = fakeFetch(() => jsonResponse({}, 404));
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    expect(await windy.getWebcamFeed('42')).toBeNull();
  });

  it('refuses IDs that are not plain numbers, without calling Windy', async () => {
    const fake = fakeFetch(() => jsonResponse({}));
    const windy = createWindyClient({apiKey: 'k', fetch: fake.fetch});

    for (const id of ['../keys', '42?x=1', '']) {
      await expect(windy.getWebcamFeed(id)).rejects.toBeInstanceOf(RangeError);
    }
    expect(fake.requests).toHaveLength(0);
  });
});

describe('isWindyKeyRejected', () => {
  it('is true only for a 401 or 403 answer', () => {
    expect(
      isWindyKeyRejected(
        new OutboundError('http-status', 'api.windy.com', 401),
      ),
    ).toBe(true);
    expect(
      isWindyKeyRejected(
        new OutboundError('http-status', 'api.windy.com', 403),
      ),
    ).toBe(true);
    expect(
      isWindyKeyRejected(
        new OutboundError('http-status', 'api.windy.com', 500),
      ),
    ).toBe(false);
    expect(
      isWindyKeyRejected(new OutboundError('timeout', 'api.windy.com')),
    ).toBe(false);
    expect(isWindyKeyRejected(new Error('other'))).toBe(false);
  });
});
