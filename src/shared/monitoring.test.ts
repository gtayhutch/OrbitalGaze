/**
 * @fileoverview Regression tests for the diagnostic data allowed to leave
 * the app, regardless of which platform's Sentry SDK generated the event.
 */
import {expect, it} from 'vitest';

import {scrubDiagnosticEvent, SentryDsnSchema} from './monitoring';

it('drops request data, user data, error values and unsafe frame fields', () => {
  const marker = 'private-marker';
  const event = {
    event_id: 'event-id',
    environment: marker,
    release: marker,
    message: marker,
    request: {headers: {authorization: marker}},
    user: {ip_address: marker},
    breadcrumbs: [{message: marker}],
    tags: {signal: 'browser.globe-render', arbitrary: marker},
    exception: {
      values: [
        {
          value: marker,
          stacktrace: {
            frames: [
              {filename: `https://example.test/${marker}`, lineno: 1},
              {
                filename: `https://orbitalgaze.com/assets/globe-AbCd1234.js?${marker}`,
                function: marker,
                lineno: 2,
                colno: 3,
              },
            ],
          },
        },
      ],
    },
  };
  const scrubbed = scrubDiagnosticEvent(
    event,
    'production',
    'test-sha',
    'browser.unhandled',
  );
  expect(JSON.stringify(scrubbed)).not.toContain(marker);
  expect(scrubbed).toMatchObject({
    environment: 'production',
    release: 'test-sha',
    fingerprint: ['browser.globe-render'],
    exception: {
      values: [
        {
          value: 'browser.globe-render',
          stacktrace: {
            frames: [{filename: 'globe-AbCd1234.js', lineno: 2, colno: 3}],
          },
        },
      ],
    },
  });
});

it('allows hosted ingestion DSNs only', () => {
  const key = 'a'.repeat(32);
  expect(
    SentryDsnSchema.safeParse(`https://${key}@o1.ingest.us.sentry.io/2`)
      .success,
  ).toBe(true);
  expect(
    SentryDsnSchema.safeParse(
      `https://${key}@o1.ingest.sentry.io.example.test/2`,
    ).success,
  ).toBe(false);
  expect(
    SentryDsnSchema.safeParse(`https://${key}:secret@o1.ingest.sentry.io/2`)
      .success,
  ).toBe(false);
});
