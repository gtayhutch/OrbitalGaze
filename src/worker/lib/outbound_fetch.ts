/**
 * @fileoverview The one way the Worker calls other services over the network.
 *
 * Layer: worker library (server only).
 *
 * Every outbound request goes through {@link fetchJson}, which enforces the
 * same safety rules for all of them:
 * - `https:` only, to a hostname on the caller's allowlist (default port);
 * - redirects are never followed: a 3xx is treated as a failure;
 * - a timeout, so a slow service can't hold the Worker open;
 * - the response must say it is JSON, and is read with a byte cap, so a
 *   huge or endless body can't exhaust memory.
 *
 * Callers pass fixed URLs they build themselves. A URL from a client or
 * from another service's data is never passed here.
 */

/** Why an outbound request failed. */
export type OutboundFailure =
  /** The URL wasn't https, or its host isn't on the allowlist. */
  | 'blocked-url'
  /** The request didn't finish within the timeout. */
  | 'timeout'
  /** The connection failed. */
  | 'network'
  /** The service answered with a redirect. */
  | 'redirect'
  /** The service answered with a status other than 2xx. */
  | 'http-status'
  /** The response wasn't JSON, or wasn't valid JSON. */
  | 'invalid-body'
  /** The response was larger than allowed. */
  | 'too-large';

/** An outbound request that failed. The message never includes headers. */
export class OutboundError extends Error {
  /**
   * @param failure The kind of failure.
   * @param host The host that was called, for logs.
   * @param status The HTTP status, when the service answered.
   */
  constructor(
    readonly failure: OutboundFailure,
    readonly host: string,
    readonly status: number | null = null,
  ) {
    super(
      `Outbound request to ${host} failed: ${failure}` +
        (status === null ? '' : ` (HTTP ${status})`),
    );
    this.name = 'OutboundError';
  }
}

/** A `fetch`-compatible function; tests inject a fake one. */
export type FetchFunction = (
  input: Request | string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Options for {@link fetchJson} and {@link fetchText}. */
export interface FetchJsonOptions {
  /** Hostnames this request may go to, for example `api.windy.com`. */
  readonly allowedHosts: readonly string[];
  /** Request headers, such as an API key. They are never logged. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Give up after this many milliseconds. */
  readonly timeoutMs: number;
  /** Largest response body accepted, in bytes. */
  readonly maxBytes: number;
  /** The `fetch` to use. Defaults to the runtime's. */
  readonly fetch?: FetchFunction | undefined;
}

/**
 * Checks that `url` is https on an allowed host with the default port.
 *
 * @param url The URL to check.
 * @param allowedHosts Hostnames that are allowed.
 * @returns True if the URL may be requested.
 */
export function isAllowedUrl(
  url: URL,
  allowedHosts: readonly string[],
): boolean {
  return (
    url.protocol === 'https:' &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    allowedHosts.includes(url.hostname)
  );
}

/**
 * Reads a response body as text, stopping as soon as it passes `maxBytes`.
 *
 * @param response The response to read.
 * @param maxBytes Largest body accepted.
 * @param host The host, for the error.
 * @returns The body text.
 * @throws {OutboundError} `too-large` when the body is over the cap.
 */
async function readTextWithLimit(
  response: Response,
  maxBytes: number,
  host: string,
): Promise<string> {
  return new TextDecoder().decode(
    await readBytesWithLimit(response, maxBytes, host),
  );
}

/**
 * Reads a response body as bytes, stopping as soon as it passes `maxBytes`.
 *
 * @param response The response to read.
 * @param maxBytes Largest body accepted.
 * @param host The host, for the error.
 * @returns The body bytes.
 * @throws {OutboundError} `too-large` when the body is over the cap.
 */
async function readBytesWithLimit(
  response: Response,
  maxBytes: number,
  host: string,
): Promise<Uint8Array> {
  // A declared length over the cap fails before anything is read.
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new OutboundError('too-large', host, response.status);
  }
  if (response.body === null) {
    return new Uint8Array(0);
  }
  // Count bytes while streaming; the declared length can be missing or wrong.
  // Response bodies are byte streams; the runtime types them loosely.
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new OutboundError('too-large', host, response.status);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Sends a checked request (a GET, or a form POST) and returns the successful response.
 *
 * Shared by {@link fetchJson} and {@link fetchText}: the URL must pass the
 * allowlist, redirects are failures, and only a 2xx with an expected
 * content type gets through. The body is left unread.
 *
 * @param url The URL to request, built by the caller from fixed parts.
 * @param options Allowlist, headers, timeout, and size cap.
 * @param accept The `Accept` header to send.
 * @param isExpectedType Whether a response's `Content-Type` is acceptable.
 * @param body For a POST, the form to send (URL-encoded); otherwise a GET.
 * @returns The response, with its body still to be read.
 * @throws {OutboundError} For every kind of failure; see {@link OutboundFailure}.
 */
async function sendCheckedRequest(
  url: URL,
  options: FetchJsonOptions,
  accept: string,
  isExpectedType: (contentType: string) => boolean,
  body?: URLSearchParams,
): Promise<Response> {
  const host = url.hostname;
  // Step 1: refuse anything that isn't https to an allowed host.
  if (!isAllowedUrl(url, options.allowedHosts)) {
    throw new OutboundError('blocked-url', host);
  }

  // Step 2: send the request with a timeout and without following redirects.
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(url.toString(), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: accept,
        ...(body === undefined
          ? {}
          : {'Content-Type': 'application/x-www-form-urlencoded'}),
        ...options.headers,
      },
      ...(body === undefined ? {} : {body: body.toString()}),
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException &&
      (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new OutboundError(timedOut ? 'timeout' : 'network', host);
  }

  // Step 3: only a 2xx answer of the expected type is accepted.
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new OutboundError('redirect', host, response.status);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new OutboundError('http-status', host, response.status);
  }
  if (!isExpectedType(response.headers.get('Content-Type') ?? '')) {
    await response.body?.cancel();
    throw new OutboundError('invalid-body', host, response.status);
  }
  return response;
}

/**
 * Sends a GET request and returns the parsed JSON body.
 *
 * @param url The URL to request. Built by the caller from fixed parts.
 * @param options Allowlist, headers, timeout, and size cap.
 * @returns The parsed JSON, not yet validated: callers check it with a schema.
 * @throws {OutboundError} For every kind of failure; see {@link OutboundFailure}.
 * @example
 * const body = await fetchJson(new URL('https://api.windy.com/webcams/api/v3/webcams'), {
 *   allowedHosts: ['api.windy.com'],
 *   headers: {'x-windy-api-key': key},
 *   timeoutMs: 10_000,
 *   maxBytes: 2_000_000,
 * });
 */
export async function fetchJson(
  url: URL,
  options: FetchJsonOptions,
): Promise<unknown> {
  const response = await sendCheckedRequest(
    url,
    options,
    'application/json',
    contentType => /^application\/(?:[\w.+-]+\+)?json\b/i.test(contentType),
  );
  // Step 4: read with the size cap, then parse.
  const text = await readTextWithLimit(
    response,
    options.maxBytes,
    url.hostname,
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new OutboundError('invalid-body', url.hostname, response.status);
  }
}

/**
 * Sends a GET request and returns the body as text, for feeds published as
 * CSV or plain text.
 *
 * @param url The URL to request. Built by the caller from fixed parts.
 * @param options Allowlist, headers, timeout, and size cap.
 * @returns The body text, not yet validated: callers parse and check it.
 * @throws {OutboundError} For every kind of failure; see {@link OutboundFailure}.
 *     A JSON or HTML answer (an error page) is `invalid-body`.
 * @example
 * const csv = await fetchText(new URL('https://data.example.org/feed.csv'), {
 *   allowedHosts: ['data.example.org'],
 *   timeoutMs: 20_000,
 *   maxBytes: 4_000_000,
 * });
 */
export async function fetchText(
  url: URL,
  options: FetchJsonOptions,
): Promise<string> {
  const response = await sendCheckedRequest(
    url,
    options,
    'text/csv, text/plain',
    contentType =>
      /^(?:text\/(?:csv|plain)|application\/csv)\b/i.test(contentType),
  );
  return readTextWithLimit(response, options.maxBytes, url.hostname);
}

/**
 * Sends a GET request and returns the body as bytes, for binary feeds such
 * as map imagery tiles.
 *
 * @param url The URL to request. Built by the caller from fixed parts.
 * @param options Allowlist, headers, timeout, and size cap.
 * @param contentType The exact media type expected, for example
 *     `image/jpeg`; anything else (such as an XML error page) is refused.
 * @returns The body bytes.
 * @throws {OutboundError} For every kind of failure; see {@link OutboundFailure}.
 * @example
 * const jpeg = await fetchBytes(tileUrl, {allowedHosts: ['gibs.earthdata.nasa.gov'],
 *   timeoutMs: 10_000, maxBytes: 1_000_000}, 'image/jpeg');
 */
export async function fetchBytes(
  url: URL,
  options: FetchJsonOptions,
  contentType: string,
): Promise<Uint8Array> {
  const expected = contentType.toLowerCase();
  const response = await sendCheckedRequest(
    url,
    options,
    expected,
    actual => actual.toLowerCase().split(';')[0]?.trim() === expected,
  );
  return readBytesWithLimit(response, options.maxBytes, url.hostname);
}

/**
 * Logs in to a service with a form POST and returns its session cookie, for
 * APIs that authenticate with a cookie (such as Space-Track.org).
 *
 * The form (which holds credentials) and the cookie are never logged or
 * placed in an error message.
 *
 * @param url The login URL, built from fixed parts.
 * @param form The form fields, for example `identity` and `password`.
 * @param options Allowlist, timeout, and size cap (for the small answer).
 * @param isRefusal Whether the answer's text means the login was refused,
 *     for services that answer a failed login with HTTP 200.
 * @returns A `Cookie` header value with every cookie the service set.
 * @throws {OutboundError} `http-status` (403) for a refused login or a
 *     missing cookie; otherwise as for any request.
 * @example
 * const cookie = await postFormForCookie(loginUrl, form, options, text => text.includes('Failed'));
 */
export async function postFormForCookie(
  url: URL,
  form: URLSearchParams,
  options: FetchJsonOptions,
  isRefusal: (text: string) => boolean,
): Promise<string> {
  const response = await sendCheckedRequest(
    url,
    options,
    'application/json, text/plain, */*',
    () => true,
    form,
  );
  // Read the (small) answer first: a refusal can come with HTTP 200.
  const text = await readTextWithLimit(
    response,
    options.maxBytes,
    url.hostname,
  );
  if (isRefusal(text)) {
    throw new OutboundError('http-status', url.hostname, 403);
  }
  // Keep only "name=value" from each Set-Cookie header.
  const cookies = response.headers
    .getSetCookie()
    .map(header => header.split(';')[0]?.trim() ?? '')
    .filter(pair => pair.includes('='));
  if (cookies.length === 0) {
    throw new OutboundError('http-status', url.hostname, 403);
  }
  return cookies.join('; ');
}
