/**
 * @fileoverview Integration tests for the API's middleware chain.
 *
 * Layer: worker tests (run inside workerd with the local bindings).
 *
 * Requests go through the Worker's real entry point, so these tests cover
 * routing, the middleware chain, security headers, and the shared response
 * shapes together.
 */
import {describe, expect, it} from 'vitest';

import {ApiErrorResponseSchema} from '@/shared/api/api_error';
import {dataEnvelope} from '@/shared/api/envelope';
import {HealthResponseSchema} from '@/shared/api/health';

import {getPath} from './test_support/send_request';

describe('GET /api/v1/health', () => {
  it('reports ok and the local environment inside the data envelope', async () => {
    const response = await getPath('/api/v1/health');

    expect(response.status).toBe(200);
    expect(
      dataEnvelope(HealthResponseSchema).parse(await response.json()),
    ).toEqual({data: {status: 'ok', environment: 'test'}});
  });

  it('sends the API security header baseline', async () => {
    const response = await getPath('/api/v1/health');

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
  });

  it('is not cacheable by default', async () => {
    const response = await getPath('/api/v1/health');

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a fresh request ID and ignores one supplied by the caller', async () => {
    const response = await getPath('/api/v1/health', {
      'X-Request-Id': 'injected',
    });

    const requestId = response.headers.get('X-Request-Id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe('injected');
  });
});

describe('unknown API paths', () => {
  it('answer 404 in the shared error shape with security headers', async () => {
    const response = await getPath('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    const body = ApiErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.requestId).toBe(response.headers.get('X-Request-Id'));
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('rate limiting', () => {
  it('answers 429 with Retry-After once an address exceeds the search budget', async () => {
    // A dedicated address so other tests' requests don't count against it.
    const headers = {'CF-Connecting-IP': '203.0.113.7'};
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await getPath('/api/v1/cameras/search?q=tokyo', headers);
      statuses.push(response.status);
    }

    expect(statuses.every(status => status === 200)).toBe(true);
    const limited = await getPath('/api/v1/cameras/search?q=tokyo', headers);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(ApiErrorResponseSchema.parse(await limited.json()).error.code).toBe(
      'RATE_LIMITED',
    );
  });

  it('counts each address separately', async () => {
    const response = await getPath('/api/v1/cameras/search?q=tokyo', {
      'CF-Connecting-IP': '203.0.113.8',
    });

    expect(response.status).toBe(200);
  });
});
