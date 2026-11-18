/**
 * @fileoverview Exercises browser policy reports through the real Worker,
 * including rejected bodies and the fields written to Workers Logs.
 */
import {describe, expect, it, vi} from 'vitest';

import {sendRequest, TEST_ORIGIN} from '../../test_support/send_request';

/** Builds a POST using the content type of a real browser report. */
function sendReport(body: string, contentType = 'application/csp-report') {
  return sendRequest(
    new Request(`${TEST_ORIGIN}/api/v1/csp-reports`, {
      method: 'POST',
      headers: {'Content-Type': contentType},
      body,
    }),
  );
}

describe('CSP reports', () => {
  it('accepts a browser report and logs only fixed categories', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const response = await sendReport(
        JSON.stringify({
          'csp-report': {
            'effective-directive': 'not-a-directive',
            disposition: 'enforce',
            'document-uri': 'https://example.test/?value=private-marker',
            'script-sample': 'private-marker',
          },
        }),
      );

      expect(response.status).toBe(204);
      const messages = log.mock.calls.flat().join('\n');
      expect(messages).toContain('"directive":"other","disposition":"enforce"');
      expect(messages).not.toContain('private-marker');
      expect(messages).not.toContain('not-a-directive');
    } finally {
      log.mockRestore();
    }
  });

  it('rejects malformed, unknown, oversized and wrongly typed payloads', async () => {
    const report = JSON.stringify({
      'csp-report': {'effective-directive': 'script-src'},
    });
    expect((await sendReport('{')).status).toBe(400);
    expect((await sendReport('{"unexpected":true}')).status).toBe(400);
    expect((await sendReport(' '.repeat(4096) + report)).status).toBe(400);
    expect((await sendReport(report, 'application/json')).status).toBe(400);
  });
});
