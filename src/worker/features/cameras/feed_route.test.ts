/**
 * @fileoverview Integration tests for `GET /api/v1/cameras/:id/feed`.
 *
 * Layer: worker tests (workerd with a real local D1 and cache). Windy is the
 * only thing faked, by replacing the runtime's `fetch` for these tests.
 *
 * Covers who gets a feed (never hidden or feedless cameras), that every link
 * is checked against the source's allowed hosts, that failures upstream
 * become a generic error, that the API key never leaves the server, and
 * that results are cached.
 */
import {env} from 'cloudflare:workers';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';
import {dataEnvelope} from '@/shared/api/envelope';
import {CameraFeedSchema} from '@/shared/cameras';

import {buildCamera, seedCameras} from '../../test_support/factories';
import {getPath} from '../../test_support/send_request';
import {jsonResponse} from '../../test_support/windy_fakes';
import {createCameraRepository, type NewCamera} from './repository';
import {WINDY_SOURCE} from './sources/windy/adapter';

/** A key that must never appear in a response. */
const TEST_KEY = 'feed-test-windy-key';

/** The test bindings with a Windy key set. */
const envWithKey: Env = {...env, WINDY_API_KEY: TEST_KEY};

/** Counter for unique Windy webcam IDs within this file. */
let nextWebcamId = 500;

/** Stores an online Windy camera and returns it. */
async function seedWindyCamera(
  overrides: Partial<NewCamera> = {},
): Promise<NewCamera> {
  const webcamId = String(nextWebcamId++);
  const camera = buildCamera(WINDY_SOURCE.id, {
    id: `windy-${webcamId}`,
    externalId: webcamId,
    streamType: 'embed',
    streamRef: webcamId,
    ...overrides,
  });
  await createCameraRepository(env.DB).insertCameras([camera]);
  return camera;
}

/** Windy's single-webcam answer for `webcamId`, with overridable links. */
function windyFeed(
  webcamId: string,
  links: {preview?: string; day?: string; detail?: string; live?: string} = {},
) {
  return {
    webcamId: Number(webcamId),
    status: 'active',
    images: {
      current: {
        preview:
          links.preview ??
          `https://imgproxy.windy.com/_/preview/plain/current/${webcamId}/original.jpg?token=abc`,
        thumbnail: `https://imgproxy.windy.com/_/thumbnail/plain/current/${webcamId}/original.jpg?token=abc`,
      },
      sizes: {
        preview: {width: 400, height: 224},
        thumbnail: {width: 200, height: 112},
      },
    },
    player: {
      day:
        links.day ??
        `https://webcams.windy.com/webcams/public/embed/player/${webcamId}/day`,
      ...(links.live === undefined ? {} : {live: links.live}),
    },
    // Windy's real shape: the camera page is on the bare `windy.com` host,
    // and the extra links (an admin page, the operator's own http site) are
    // never passed on.
    urls: {
      detail: links.detail ?? `https://windy.com/webcams/${webcamId}`,
      edit: `https://webcams-admin.windy.com/webcams/${webcamId}`,
      provider: 'http://operator.example/weather.html',
    },
  };
}

/** Requests the feed for `id` with the Windy key set. */
async function getFeed(id: string, bindings: Env = envWithKey) {
  return getPath(`/api/v1/cameras/${id}/feed`, {}, bindings);
}

let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  await createCameraRepository(env.DB).upsertSource(WINDY_SOURCE);
});

beforeEach(() => {
  // By default Windy answers with a normal feed for whichever ID was asked.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const webcamId = url.pathname.split('/').at(-1) ?? '';
    return Promise.resolve(jsonResponse(windyFeed(webcamId)));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The Windy requests made during the test. */
function windyRequests(): Array<{url: URL; headers: Headers}> {
  return fetchSpy.mock.calls.map(([input, init]) => ({
    url: new URL(input instanceof Request ? input.url : String(input)),
    headers: new Headers(init?.headers),
  }));
}

describe('GET /api/v1/cameras/:id/feed', () => {
  it('returns fresh links from Windy for a Windy camera', async () => {
    const camera = await seedWindyCamera();

    const response = await getFeed(camera.id);

    expect(response.status).toBe(200);
    const {data} = dataEnvelope(CameraFeedSchema).parse(await response.json());
    expect(data).toMatchObject({
      kind: 'windy',
      imageWidth: 400,
      imageHeight: 224,
      pageUrl: `https://windy.com/webcams/${camera.externalId}`,
      timelapseUrl: `https://webcams.windy.com/webcams/public/embed/player/${camera.externalId}/day`,
      liveUrl: null,
    });
    expect(new URL(data.imageUrl).hostname).toBe('imgproxy.windy.com');
    expect(Date.parse(data.expiresAt)).toBeGreaterThan(Date.now());

    const [request] = windyRequests();
    expect(request?.url.pathname).toBe(
      `/webcams/api/v3/webcams/${camera.externalId}`,
    );
    expect(request?.url.searchParams.get('include')).toBe('images,player,urls');
    expect(request?.headers.get('x-windy-api-key')).toBe(TEST_KEY);
  });

  it('never sends the API key to the browser', async () => {
    const camera = await seedWindyCamera();

    const response = await getFeed(camera.id);

    expect(await response.text()).not.toContain(TEST_KEY);
  });

  it('serves a cached copy instead of asking Windy again', async () => {
    const camera = await seedWindyCamera();

    await getFeed(camera.id);
    const second = await getFeed(camera.id);

    expect(second.status).toBe(200);
    expect(second.headers.get('Cache-Control')).toBe('public, max-age=240');
    expect(windyRequests()).toHaveLength(1);
  });

  it('answers 404 without calling Windy for hidden and feedless cameras', async () => {
    const hidden = await seedWindyCamera({status: 'hidden'});
    const {cameras} = await seedCameras([{streamType: null, streamRef: null}]);

    for (const id of [hidden.id, cameras[0]?.id ?? '', 'no-such-camera']) {
      const response = await getFeed(id);
      expect(response.status).toBe(404);
      expect(
        ApiErrorResponseSchema.parse(await response.json()).error.code,
      ).toBe('NOT_FOUND');
    }
    expect(windyRequests()).toHaveLength(0);
  });

  it('answers 404 when no Windy key is set', async () => {
    const camera = await seedWindyCamera();

    const response = await getFeed(camera.id, {...env, WINDY_API_KEY: ''});

    expect(response.status).toBe(404);
    expect(windyRequests()).toHaveLength(0);
  });

  it('drops links to hosts the source does not allow', async () => {
    const badPlayer = await seedWindyCamera();
    const badImage = await seedWindyCamera();
    fetchSpy.mockImplementation(input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const webcamId = url.pathname.split('/').at(-1) ?? '';
      return Promise.resolve(
        jsonResponse(
          webcamId === badPlayer.externalId
            ? windyFeed(webcamId, {day: 'https://evil.example.com/player'})
            : windyFeed(webcamId, {
                preview: 'http://imgproxy.windy.com/insecure.jpg',
              }),
        ),
      );
    });

    const playerResponse = await getFeed(badPlayer.id);
    const {data} = dataEnvelope(CameraFeedSchema).parse(
      await playerResponse.json(),
    );
    expect(data.timelapseUrl).toBeNull();

    // The insecure preview is dropped and the (valid) thumbnail is used.
    const imageResponse = await getFeed(badImage.id);
    const image = dataEnvelope(CameraFeedSchema).parse(
      await imageResponse.json(),
    ).data;
    expect(image.imageUrl).toContain('/thumbnail/');
    expect(image.imageWidth).toBe(200);
  });

  it('answers 404 when Windy has no safe image or page link', async () => {
    const camera = await seedWindyCamera();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        jsonResponse(
          windyFeed(camera.externalId, {
            detail: 'https://phishing.example.com/windy',
          }),
        ),
      ),
    );

    expect((await getFeed(camera.id)).status).toBe(404);
  });

  it('answers 404 when Windy no longer knows the webcam', async () => {
    const camera = await seedWindyCamera();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse({message: 'Not found'}, 404)),
    );

    expect((await getFeed(camera.id)).status).toBe(404);
  });

  it('turns a Windy failure into a generic error without upstream details', async () => {
    const camera = await seedWindyCamera();
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse({message: 'upstream-secret-detail'}, 500)),
    );

    const response = await getFeed(camera.id);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('upstream-secret-detail');
    expect(ApiErrorResponseSchema.parse(JSON.parse(text)).error).toMatchObject({
      code: 'INTERNAL',
      message: "The preview can't be loaded right now.",
    });
  });

  it('rejects a malformed camera ID before any lookup', async () => {
    const response = await getFeed('bad%20id');

    expect(response.status).toBe(400);
    expect(windyRequests()).toHaveLength(0);
  });
});
