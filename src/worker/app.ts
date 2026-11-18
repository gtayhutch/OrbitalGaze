/**
 * @fileoverview The API application: middleware chain and route mounting.
 *
 * Layer: worker (server only). Called by `index.ts` for every `/api/*`
 * request; other paths are static files served without running Worker code.
 *
 * Pattern: Chain of Responsibility. Each request passes through the same
 * middleware, in order, before reaching a route:
 *
 *   1. request ID: a fresh ID, attached to the context and the response.
 *   2. request logger: a per-request logger plus one "request completed" line.
 *   3. security headers: the API's header baseline (see `lib/security_headers.ts`).
 *   4. caching default: `no-store` unless the route chose a cache policy.
 *   5. configuration: validated settings attached as `c.var.config`.
 *   6. rate limiting: too many requests from one address get a 429
 *      (see `lib/rate_limit.ts`).
 *   7. the matched route (which validates its own input), or the not-found
 *      handler.
 *
 * Every route is mounted here and nowhere else, so no endpoint can skip the
 * chain. Errors from any step land in one handler that answers with the
 * shared error shape.
 */
import {Hono, type MiddlewareHandler} from 'hono';

import type {AppContext} from './app_context';
import {cameraRoutes} from './features/cameras';
import {cspReportRoutes} from './features/csp_reports';
import {healthRoutes} from './features/health';
import {
  createLayerRoutes,
  SNAPSHOT_SOURCES,
  type SnapshotSource,
} from './features/layers';
import {parseWorkerConfig} from './lib/config';
import {reportUnexpectedApiError} from './lib/error_reporting';
import {AppError, buildErrorBody} from './lib/errors';
import {createLogger} from './lib/logger';
import {rateLimit} from './lib/rate_limit';
import {apiSecurityHeaders} from './lib/security_headers';

/** Response header that carries the request ID back to the caller. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Gives each request a fresh random ID.
 *
 * A caller-supplied ID is deliberately ignored: our logs should only contain
 * IDs we generated, so nobody can inject misleading entries.
 */
const assignRequestId: MiddlewareHandler<AppContext> = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);
  await next();
};

/** Attaches a per-request logger and logs one line when the request finishes. */
const logRequests: MiddlewareHandler<AppContext> = async (c, next) => {
  const logger = createLogger({requestId: c.var.requestId});
  c.set('logger', logger);
  const startedAt = Date.now();
  await next();
  // Log the path without its query string; queries can hold user input.
  logger.info('request completed', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
  });
};

/**
 * Makes `no-store` the default cache policy. Routes whose answers are safe to
 * cache (the same for every visitor) set their own `Cache-Control`, which this
 * leaves alone.
 */
const defaultToNoStore: MiddlewareHandler<AppContext> = async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) {
    c.header('Cache-Control', 'no-store');
  }
};

/** Validates the Worker's settings and attaches them as `c.var.config`. */
const loadConfig: MiddlewareHandler<AppContext> = async (c, next) => {
  c.set('config', parseWorkerConfig(c.env));
  await next();
};

/** Options for {@link createApp}; production uses the defaults. */
export interface AppOptions {
  /**
   * The snapshot layers served under `/api/v1/layers`. Defaults to
   * `SNAPSHOT_SOURCES`; tests pass fake layers.
   */
  readonly snapshotSources?: readonly SnapshotSource[];
}

/**
 * Builds the API application.
 *
 * @param options Overrides for tests; production passes none.
 * @returns A Hono app that handles every path under `/api`.
 * @example
 * const app = createApp();
 * const response = await app.request('/api/v1/health', {}, env);
 */
export function createApp(options: AppOptions = {}): Hono<AppContext> {
  const app = new Hono<AppContext>().basePath('/api');

  // The middleware chain, in the order described in the file header.
  app.use(assignRequestId);
  app.use(logRequests);
  app.use(apiSecurityHeaders);
  app.use(defaultToNoStore);
  app.use(loadConfig);
  app.use(rateLimit);

  // Routes. Each feature exposes a router through its index.ts.
  app.route('/v1/health', healthRoutes);
  app.route('/v1/cameras', cameraRoutes);
  app.route('/v1/csp-reports', cspReportRoutes);
  app.route(
    '/v1/layers',
    createLayerRoutes(options.snapshotSources ?? SNAPSHOT_SOURCES),
  );

  app.notFound(c =>
    c.json(
      buildErrorBody(
        'NOT_FOUND',
        'No API endpoint at this path.',
        c.var.requestId,
      ),
      404,
    ),
  );

  app.onError((error, c) => {
    // Expected failures carry a safe message and their own status.
    if (error instanceof AppError) {
      return c.json(
        buildErrorBody(
          error.code,
          error.publicMessage,
          c.var.requestId,
          error.fieldErrors,
        ),
        error.status,
      );
    }
    // Anything else is a bug. Log the details; tell the client only that it
    // failed. The request ID and logger are always present here: the first
    // two middleware steps attach them and can't fail.
    reportUnexpectedApiError(error);
    c.var.logger.error('unhandled error', {
      errorName: error.name,
      path: c.req.path,
    });
    return c.json(
      buildErrorBody(
        'INTERNAL',
        'Something went wrong on our side.',
        c.var.requestId,
      ),
      500,
    );
  });

  return app;
}
