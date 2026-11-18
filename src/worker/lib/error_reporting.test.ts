/**
 * @fileoverview Checks the actual Sentry envelope at the outbound HTTP
 * boundary in workerd. The fake DSN never sends a real network request.
 */
import {env} from 'cloudflare:workers';
import {expect, it, vi} from 'vitest';

import {sendRequest, TEST_ORIGIN} from '../test_support/send_request';
import {
  reportUnexpectedApiError,
  withWorkerErrorReporting,
} from './error_reporting';

it('ships a scrubbed error in hosted mode and skips local reporting', async () => {
  const marker = 'private-marker';
  const transport = vi.fn<typeof fetch>(() =>
    Promise.resolve(new Response(null, {status: 200})),
  );
  vi.stubGlobal('fetch', transport);
  try {
    const handler = withWorkerErrorReporting({
      fetch: () => {
        reportUnexpectedApiError(new Error(marker));
        return new Response(null, {status: 500});
      },
    });
    const request = () => new Request(`${TEST_ORIGIN}/?private=${marker}`);
    const sentryDsn = `https://${'a'.repeat(32)}@o1.ingest.sentry.io/2`;
    const testEnv = {...env, SENTRY_DSN: sentryDsn};
    expect((await sendRequest(request(), testEnv, handler.fetch)).status).toBe(
      500,
    );
    expect(transport).not.toHaveBeenCalled();

    const hostedEnv = {...testEnv, APP_ENV: 'staging' as const};
    expect(
      (await sendRequest(request(), hostedEnv, handler.fetch)).status,
    ).toBe(500);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0] ?? [];
    expect(url).toEqual(
      expect.stringMatching(
        /^https:\/\/o1\.ingest\.sentry\.io\/api\/2\/envelope\//,
      ),
    );
    const body =
      typeof options?.body === 'string'
        ? options.body
        : await new Response(options?.body).text();
    expect(body).toContain('"environment":"staging"');
    expect(body).toContain('"signal":"worker.api"');
    expect(body).not.toContain(marker);
  } finally {
    vi.unstubAllGlobals();
  }
});
