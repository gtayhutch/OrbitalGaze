/**
 * @fileoverview Per-address rate limiting for every API route.
 *
 * Layer: worker library (server only). Part of the middleware chain in
 * `app.ts`.
 *
 * Uses Cloudflare's rate limiting bindings (configured in wrangler.jsonc),
 * which count requests per key at the edge without a database. Routes fall
 * into groups with their own budgets:
 *
 * - `search` and `csp-report`: separate budgets of 30 requests per minute,
 *   both backed by SEARCH_RATE_LIMITER with distinct keys.
 * - `api`: everything else (API_RATE_LIMITER, 300 requests per minute).
 *
 * The key is the visitor's IP address as reported by Cloudflare in
 * `CF-Connecting-IP`, which clients can't forge when traffic arrives through
 * Cloudflare. `X-Forwarded-For` is never trusted, because any client can set
 * it. The limits are per Cloudflare location and approximate by design; they
 * blunt abuse rather than meter usage exactly.
 */
import type {MiddlewareHandler} from 'hono';

import type {AppContext} from '../app_context';
import {buildErrorBody} from './errors';

/** Seconds a limited client should wait; matches the bindings' 60 s period. */
export const RATE_LIMIT_RETRY_AFTER_SECONDS = 60;

/** Which budget a request counts against. */
export type RateLimitGroup = 'search' | 'csp-report' | 'api';

/** Path prefix of the search endpoint, which has its own smaller budget. */
const SEARCH_PATH_PREFIX = '/api/v1/cameras/search';

/** The browser's endpoint for reporting a policy violation. */
const CSP_REPORT_PATH = '/api/v1/csp-reports';

/**
 * Picks the budget for a request path.
 *
 * @param path The request path, without query string.
 * @returns The group whose limit applies.
 */
export function rateLimitGroupFor(path: string): RateLimitGroup {
  if (path === CSP_REPORT_PATH) {
    return 'csp-report';
  }
  return path.startsWith(SEARCH_PATH_PREFIX) ? 'search' : 'api';
}

/**
 * Middleware that answers 429 when an address exceeds its group's budget.
 *
 * Requests without `CF-Connecting-IP` (local development and tests) share one
 * key, so the limits still apply there.
 */
export const rateLimit: MiddlewareHandler<AppContext> = async (c, next) => {
  const group = rateLimitGroupFor(c.req.path);
  const clientAddress = c.req.header('CF-Connecting-IP') ?? 'local';
  const limiter =
    group === 'api' ? c.env.API_RATE_LIMITER : c.env.SEARCH_RATE_LIMITER;

  const {success} = await limiter.limit({key: `${group}:${clientAddress}`});
  if (!success) {
    c.header('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS));
    return c.json(
      buildErrorBody(
        'RATE_LIMITED',
        'Too many requests. Please wait a minute and try again.',
        c.var.requestId,
      ),
      429,
    );
  }
  await next();
  return undefined;
};
