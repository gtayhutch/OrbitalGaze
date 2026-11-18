/**
 * @fileoverview Validates browser CSP reports before the Worker logs them.
 *
 * The browser includes URLs and sometimes source text in a report. Only
 * policy categories and the disposition are eligible for logging.
 */
import {z} from 'zod';

/** Directive names the app's browser policy can report. */
const KnownDirectiveSchema = z.enum([
  'base-uri',
  'connect-src',
  'default-src',
  'font-src',
  'form-action',
  'frame-ancestors',
  'frame-src',
  'img-src',
  'object-src',
  'script-src',
  'script-src-attr',
  'script-src-elem',
  'style-src',
  'style-src-attr',
  'style-src-elem',
  'worker-src',
]);

/** A standards-based report envelope with possible browser metadata. */
export const CspReportSchema = z.strictObject({
  'csp-report': z.strictObject({
    'effective-directive': z
      .string()
      .min(1)
      .max(64)
      .transform(value => {
        const parsed = KnownDirectiveSchema.safeParse(value);
        return parsed.success ? parsed.data : 'other';
      }),
    disposition: z.enum(['enforce', 'report']).optional(),
    'blocked-uri': z.string().optional(),
    'document-uri': z.string().optional(),
    'original-policy': z.string().optional(),
    'source-file': z.string().optional(),
    'violated-directive': z.string().optional(),
    'script-sample': z.string().optional(),
    referrer: z.string().optional(),
    'line-number': z.number().int().nonnegative().optional(),
    'column-number': z.number().int().nonnegative().optional(),
    'status-code': z.number().int().nonnegative().optional(),
  }),
});
