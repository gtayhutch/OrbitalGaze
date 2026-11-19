/**
 * @fileoverview Tests for the outbound request helper's safety rules.
 *
 * Layer: worker tests (workerd). The network is replaced by a fake `fetch`.
 */
import {describe, expect, it} from 'vitest';

import {fakeFetch, jsonResponse} from '../test_support/windy_fakes';
import {
  fetchJson,
  fetchText,
  isAllowedUrl,
  OutboundError,
} from './outbound_fetch';

/** Options shared by most tests: one allowed host, small limits. */
const baseOptions = {
  allowedHosts: ['api.example.com'],
  timeoutMs: 1_000,
  maxBytes: 1_000,
};

/** Runs `fetchJson` and returns the `OutboundError` it throws. */
async function failureOf(promise: Promise<unknown>): Promise<OutboundError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OutboundError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected an OutboundError.');
}

describe('isAllowedUrl', () => {
  it('allows https to a listed host on the default port', () => {
    expect(
      isAllowedUrl(new URL('https://api.example.com/x'), ['api.example.com']),
    ).toBe(true);
  });

  it('refuses other schemes, hosts, ports, and embedded credentials', () => {
    const hosts = ['api.example.com'];
    for (const url of [
      'http://api.example.com/x',
      'https://evil.example.com/x',
      'https://api.example.com.evil.com/x',
      'https://api.example.com:8443/x',
      'https://user:pass@api.example.com/x',
      'https://169.254.169.254/latest/meta-data',
    ]) {
      expect(isAllowedUrl(new URL(url), hosts)).toBe(false);
    }
  });
});

describe('fetchJson', () => {
  it('returns parsed JSON and never follows redirects', async () => {
    const fake = fakeFetch(() => jsonResponse({ok: true}));

    const body = await fetchJson(new URL('https://api.example.com/x'), {
      ...baseOptions,
      fetch: fake.fetch,
    });

    expect(body).toEqual({ok: true});
    expect(fake.requests[0]?.redirect).toBe('manual');
  });

  it('refuses a host that is not allowed without sending anything', async () => {
    const fake = fakeFetch(() => jsonResponse({}));

    const error = await failureOf(
      fetchJson(new URL('https://other.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('blocked-url');
    expect(fake.requests).toHaveLength(0);
  });

  it('treats a redirect as a failure', async () => {
    const fake = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: {Location: 'http://169.254.169.254/'},
        }),
    );

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('redirect');
    expect(error.status).toBe(302);
  });

  it('reports an error status with its code', async () => {
    const fake = fakeFetch(() => jsonResponse({}, 401));

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('http-status');
    expect(error.status).toBe(401);
  });

  it('rejects a body that is not JSON', async () => {
    const fake = fakeFetch(
      () => new Response('<html>', {headers: {'Content-Type': 'text/html'}}),
    );

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('invalid-body');
  });

  it('stops reading a body larger than the cap, even without a length header', async () => {
    const fake = fakeFetch(() => {
      // A stream with no Content-Length, so only the running count can catch it.
      const chunk = new TextEncoder().encode('x'.repeat(600));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.enqueue(chunk);
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {'Content-Type': 'application/json'},
      });
    });

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('too-large');
  });

  it('reports a timeout', async () => {
    const fake = fakeFetch(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    );

    expect(error.failure).toBe('timeout');
  });

  it('never puts request headers in the error message', async () => {
    const fake = fakeFetch(() => jsonResponse({}, 500));

    const error = await failureOf(
      fetchJson(new URL('https://api.example.com/x'), {
        ...baseOptions,
        headers: {'x-api-key': 'super-secret-key'},
        fetch: fake.fetch,
      }),
    );

    expect(error.message).not.toContain('super-secret-key');
  });
});

describe('fetchText', () => {
  /** A text response with the given type and status. */
  function textResponse(
    body: string,
    contentType: string,
    status = 200,
  ): Response {
    return new Response(body, {status, headers: {'Content-Type': contentType}});
  }

  it('returns a CSV body and asks for CSV', async () => {
    const fake = fakeFetch(() =>
      textResponse('A,B\n1,2\n', 'text/csv; charset=utf-8'),
    );

    const text = await fetchText(new URL('https://api.example.com/x.csv'), {
      ...baseOptions,
      fetch: fake.fetch,
    });

    expect(text).toBe('A,B\n1,2\n');
    expect(fake.requests[0]?.headers.get('Accept')).toContain('text/csv');
    expect(fake.requests[0]?.redirect).toBe('manual');
  });

  it('accepts plain text too', async () => {
    const fake = fakeFetch(() => textResponse('hello', 'text/plain'));

    await expect(
      fetchText(new URL('https://api.example.com/x'), {
        ...baseOptions,
        fetch: fake.fetch,
      }),
    ).resolves.toBe('hello');
  });

  it('refuses an HTML error page or JSON', async () => {
    for (const type of ['text/html', 'application/json']) {
      const fake = fakeFetch(() => textResponse('<html></html>', type));

      const error = await failureOf(
        fetchText(new URL('https://api.example.com/x'), {
          ...baseOptions,
          fetch: fake.fetch,
        }),
      );

      expect(error.failure).toBe('invalid-body');
    }
  });

  it('applies the allowlist, status check and size cap', async () => {
    const fake = fakeFetch(url =>
      url.pathname === '/big'
        ? textResponse('x'.repeat(2_000), 'text/csv')
        : textResponse('', 'text/csv', 403),
    );
    const options = {...baseOptions, fetch: fake.fetch};

    expect(
      (
        await failureOf(
          fetchText(new URL('https://evil.example.com/x'), options),
        )
      ).failure,
    ).toBe('blocked-url');
    expect(
      (
        await failureOf(
          fetchText(new URL('https://api.example.com/x'), options),
        )
      ).failure,
    ).toBe('http-status');
    expect(
      (
        await failureOf(
          fetchText(new URL('https://api.example.com/big'), options),
        )
      ).failure,
    ).toBe('too-large');
  });
});
