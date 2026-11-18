/**
 * @fileoverview Fake Windy Webcams API for tests.
 *
 * Layer: worker test support (runs inside workerd during `pnpm test` only).
 *
 * Tests never call the real Windy API. These helpers build webcams in
 * Windy's v3 shape and a fake `fetch` that answers like Windy, so the client,
 * the adapter, and the import jobs run their real code against controlled
 * responses. The fake records every request for assertions.
 */
import type {FetchFunction} from '../lib/outbound_fetch';

/** A webcam in Windy's response shape (only the fields the app reads). */
export interface FakeWindyWebcam {
  webcamId: number;
  title: string;
  status: string;
  categories?: Array<{id: string; name?: string}>;
  location: {
    city?: string | null;
    region?: string | null;
    country_code?: string | null;
    latitude: number;
    longitude: number;
  };
}

/** Counter that keeps generated webcam IDs unique within a test file. */
let nextWebcamId = 1_000_000_000;

/**
 * Builds a Windy webcam with sensible defaults (an active camera in Tokyo).
 *
 * @param overrides Fields to change.
 * @returns The webcam.
 */
export function buildWindyWebcam(
  overrides: Partial<FakeWindyWebcam> = {},
): FakeWindyWebcam {
  const webcamId = nextWebcamId++;
  return {
    webcamId,
    title: `Shibuya Crossing ${webcamId}`,
    status: 'active',
    categories: [{id: 'city', name: 'City'}],
    location: {
      city: 'Tokyo',
      region: 'Tokyo',
      country_code: 'JP',
      latitude: 35.6595,
      longitude: 139.7005,
    },
    ...overrides,
  };
}

/** One recorded request to the fake. */
export interface RecordedRequest {
  readonly url: URL;
  readonly headers: Headers;
  readonly redirect: RequestInit['redirect'];
}

/** A fake `fetch` plus the requests it received. */
export interface FakeFetch {
  readonly fetch: FetchFunction;
  readonly requests: RecordedRequest[];
}

/**
 * Builds a JSON response like Windy's.
 *
 * @param body The JSON body.
 * @param status The HTTP status.
 * @returns The response.
 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8'},
  });
}

/**
 * Creates a fake `fetch` that answers every request with `respond`.
 *
 * @param respond Builds the response for a request URL.
 * @returns The fake and its request log.
 * @example
 * const fake = fakeFetch(() => jsonResponse({total: 1, webcams: [buildWindyWebcam()]}));
 */
export function fakeFetch(
  respond: (url: URL) => Response | Promise<Response>,
): FakeFetch {
  const requests: RecordedRequest[] = [];
  return {
    requests,
    fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push({
        url,
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      return respond(url);
    },
  };
}

/**
 * Creates a fake Windy that serves `webcams` as one list page.
 *
 * @param webcams The page's webcams (or any values, to test validation).
 * @returns The fake and its request log.
 */
export function fakeWindyPage(webcams: readonly unknown[]): FakeFetch {
  return fakeFetch(() => jsonResponse({total: 10_000, webcams}));
}
