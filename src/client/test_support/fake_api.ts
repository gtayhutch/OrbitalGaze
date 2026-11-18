/**
 * @fileoverview Test helper: answers the browser app's API calls without a network.
 *
 * Layer: client test support (jsdom only).
 *
 * Replaces the global `fetch` with a stub that looks up each request's path
 * in a table of canned responses. Unknown paths answer 404 in the API's
 * error shape, like the real Worker.
 */
import {vi} from 'vitest';

/** A canned response: a JSON body and optional status (default 200). */
export interface FakeResponse {
  readonly status?: number;
  readonly body: unknown;
}

/** Wraps a payload in the API's success envelope. */
export function ok(data: unknown): FakeResponse {
  return {body: {data}};
}

/** An API error response with the given status and code. */
export function apiError(status: number, code: string): FakeResponse {
  return {
    status,
    body: {error: {code, message: 'Test error.', requestId: 'test-request'}},
  };
}

/**
 * Stubs `fetch` with canned responses keyed by path (query strings included
 * when given, otherwise matched by path alone).
 *
 * @param responses Path (for example `/api/v1/health`) to response.
 * @returns The stub, to inspect calls.
 * @example
 * stubApi({'/api/v1/health': ok({status: 'ok', environment: 'test'})});
 */
export function stubApi(
  responses: Readonly<Record<string, FakeResponse>>,
): ReturnType<typeof vi.fn> {
  const stub = vi.fn((input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      'http://localhost',
    );
    const match =
      responses[url.pathname + url.search] ?? responses[url.pathname];
    const response = match ?? apiError(404, 'NOT_FOUND');
    return Promise.resolve(
      new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: {'Content-Type': 'application/json'},
      }),
    );
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}
