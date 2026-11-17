/**
 * @fileoverview Integration tests for the API's middleware chain and routes.
 *
 * Layer: worker tests (run inside workerd with the local bindings).
 *
 * Requests go through the Worker's real entry point, exactly as Cloudflare
 * would deliver them, so these tests cover routing, the middleware chain,
 * security headers, and the shared error shape together.
 */
import {createExecutionContext, waitOnExecutionContext} from 'cloudflare:test';
import {env} from 'cloudflare:workers';
import {describe, expect, it} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';
import {HealthResponseSchema} from '@/shared/api/health';

import worker from './index';

/** Origin used for test requests; any origin works inside the test runtime. */
const TEST_ORIGIN = 'https://orbitalgaze.test';

/**
 * Sends a request to the Worker's entry point with the local bindings, and
 * waits for any background work the request started.
 */
async function send(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

/** Sends a GET request for `path`. */
async function get(path: string): Promise<Response> {
  return send(new Request(`${TEST_ORIGIN}${path}`));
}

describe('GET /api/v1/health', () => {
  it('reports ok and the local environment', async () => {
    const response = await get('/api/v1/health');

    expect(response.status).toBe(200);
    expect(HealthResponseSchema.parse(await response.json())).toEqual({
      status: 'ok',
      environment: 'test',
    });
  });

  it('sends the API security header baseline', async () => {
    const response = await get('/api/v1/health');

    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe(
      'same-origin',
    );
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a fresh request ID and ignores one supplied by the caller', async () => {
    const response = await send(
      new Request(`${TEST_ORIGIN}/api/v1/health`, {
        headers: {'X-Request-Id': 'injected'},
      }),
    );

    const requestId = response.headers.get('X-Request-Id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe('injected');
  });
});

describe('unknown API paths', () => {
  it('answer 404 in the shared error shape with security headers', async () => {
    const response = await get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    const body = ApiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBe(response.headers.get('X-Request-Id'));
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});
