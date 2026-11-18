/**
 * @fileoverview Client for the Windy Webcams API (v3).
 *
 * Layer: worker feature, Windy source (server only).
 *
 * Calls go only to the fixed host `api.windy.com`, through the shared
 * outbound-fetch helper (https only, no redirects, a timeout, and a size
 * cap). The API key travels in the `x-windy-api-key` header, never in the
 * URL, so it can't end up in logs or error messages.
 */
import {
  fetchJson,
  OutboundError,
  type FetchFunction,
} from '../../../../lib/outbound_fetch';
import {
  WINDY_MAX_PAGE_SIZE,
  WindyListPageSchema,
  WindyWebcamFeedSchema,
  WindyWebcamSchema,
  type WindyWebcam,
  type WindyWebcamFeed,
} from './schemas';

/** The only host the client calls. */
export const WINDY_API_HOST = 'api.windy.com';

/** Base URL of the v3 webcams API. */
const WINDY_API_BASE = `https://${WINDY_API_HOST}/webcams/api/v3`;

/** Give up on a Windy request after this many milliseconds. */
const WINDY_TIMEOUT_MS = 10_000;

/** Largest Windy response accepted. A full list page is well under 1 MB. */
const WINDY_MAX_RESPONSE_BYTES = 2_000_000;

/** One page of webcams, with the ones that failed validation counted. */
export interface WindyListPage {
  /** How many webcams Windy has in total for this query, if it said. */
  readonly total: number | null;
  /** The webcams on this page that passed validation. */
  readonly webcams: readonly WindyWebcam[];
  /** How many webcams on this page failed validation and were dropped. */
  readonly skipped: number;
}

/** Calls to the Windy Webcams API. */
export interface WindyClient {
  /**
   * Lists webcams, most popular first.
   *
   * @param page `offset` and `limit` (at most 50).
   * @throws {OutboundError} When the request fails or the page is malformed.
   */
  listPopularWebcams(page: {
    offset: number;
    limit: number;
  }): Promise<WindyListPage>;
  /**
   * Gets one webcam's current image and player links.
   *
   * @param webcamId Windy's numeric webcam ID, as stored in `streamRef`.
   * @returns The webcam, or `null` if Windy doesn't know it.
   * @throws {OutboundError} When the request fails or the answer is malformed.
   */
  getWebcamFeed(webcamId: string): Promise<WindyWebcamFeed | null>;
}

/** Options for {@link createWindyClient}. */
export interface WindyClientOptions {
  /** The Windy API key. */
  readonly apiKey: string;
  /** The `fetch` to use; tests pass a fake. */
  readonly fetch?: FetchFunction | undefined;
}

/**
 * Whether an error means Windy rejected our API key. Retrying won't help;
 * the key needs fixing.
 *
 * @param error Any thrown value.
 * @returns True for a 401 or 403 from Windy.
 */
export function isWindyKeyRejected(error: unknown): boolean {
  return (
    error instanceof OutboundError &&
    error.failure === 'http-status' &&
    (error.status === 401 || error.status === 403)
  );
}

/**
 * Creates a Windy API client.
 *
 * @param options The API key and, for tests, a fake `fetch`.
 * @returns The client.
 * @example
 * const windy = createWindyClient({apiKey: config.windyApiKey});
 * const page = await windy.listPopularWebcams({offset: 0, limit: 50});
 */
export function createWindyClient(options: WindyClientOptions): WindyClient {
  const requestOptions = {
    allowedHosts: [WINDY_API_HOST],
    headers: {'x-windy-api-key': options.apiKey},
    timeoutMs: WINDY_TIMEOUT_MS,
    maxBytes: WINDY_MAX_RESPONSE_BYTES,
    fetch: options.fetch,
  };

  return {
    async listPopularWebcams({offset, limit}) {
      if (limit < 1 || limit > WINDY_MAX_PAGE_SIZE) {
        throw new RangeError(`limit must be 1 to ${WINDY_MAX_PAGE_SIZE}.`);
      }
      const url = new URL(`${WINDY_API_BASE}/webcams`);
      url.search = new URLSearchParams({
        offset: String(offset),
        limit: String(limit),
        sortKey: 'popularity',
        sortDirection: 'desc',
        include: 'categories,location',
        lang: 'en',
      }).toString();

      const body = await fetchJson(url, requestOptions);

      // Step 1: the page itself must have the expected shape.
      const page = WindyListPageSchema.safeParse(body);
      if (!page.success) {
        throw new OutboundError('invalid-body', WINDY_API_HOST, 200);
      }
      // Step 2: validate each webcam on its own and drop the bad ones.
      const webcams: WindyWebcam[] = [];
      for (const item of page.data.webcams) {
        const webcam = WindyWebcamSchema.safeParse(item);
        if (webcam.success) {
          webcams.push(webcam.data);
        }
      }
      return {
        total: page.data.total ?? null,
        webcams,
        skipped: page.data.webcams.length - webcams.length,
      };
    },

    async getWebcamFeed(webcamId) {
      // The ID is ours (from the database), but it still goes into a URL
      // path, so only plain digits are accepted.
      if (!/^\d{1,20}$/.test(webcamId)) {
        throw new RangeError('Windy webcam IDs are numeric.');
      }
      const url = new URL(`${WINDY_API_BASE}/webcams/${webcamId}`);
      url.search = new URLSearchParams({
        include: 'images,player,urls',
        lang: 'en',
      }).toString();

      let body: unknown;
      try {
        body = await fetchJson(url, requestOptions);
      } catch (error) {
        if (
          error instanceof OutboundError &&
          error.failure === 'http-status' &&
          error.status === 404
        ) {
          return null;
        }
        throw error;
      }
      const webcam = WindyWebcamFeedSchema.safeParse(body);
      if (!webcam.success) {
        throw new OutboundError('invalid-body', WINDY_API_HOST, 200);
      }
      return webcam.data;
    },
  };
}
