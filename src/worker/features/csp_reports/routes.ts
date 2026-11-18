/**
 * @fileoverview Receives a browser CSP violation from the static app.
 *
 * The public endpoint accepts bounded JSON and records fixed categories in
 * Workers Logs. It performs no third-party requests or storage writes.
 */
import {Hono} from 'hono';
import {bodyLimit} from 'hono/body-limit';

import type {AppContext} from '../../app_context';
import {AppError} from '../../lib/errors';
import {parseInput} from '../../lib/validation';
import {CspReportSchema} from './report_schema';

/** Maximum report size in bytes, including URLs that we discard. */
const MAX_REPORT_BYTES = 4096;

/** Receives one report from the browser and acknowledges it with 204. */
export const cspReportRoutes = new Hono<AppContext>().post(
  '/',
  bodyLimit({
    maxSize: MAX_REPORT_BYTES,
    onError: () => {
      throw new AppError('INVALID_INPUT', 'The policy report is too large.');
    },
  }),
  async c => {
    // Step 1: browsers using report-uri send this specific media type.
    const contentType = c.req.header('Content-Type')?.split(';')[0]?.trim();
    if (contentType?.toLowerCase() !== 'application/csp-report') {
      throw new AppError('INVALID_INPUT', 'Expected a browser policy report.');
    }
    let data: unknown;
    try {
      const bytes = await c.req.raw.arrayBuffer();
      data = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    } catch {
      throw new AppError('INVALID_INPUT', 'Malformed policy report.');
    }

    // Step 2: a report is untrusted. Log only the schema's bounded categories.
    const report = parseInput(CspReportSchema, data)['csp-report'];
    c.var.logger.warn('browser policy violation', {
      directive: report['effective-directive'],
      disposition: report.disposition ?? null,
    });
    return c.body(null, 204);
  },
);
