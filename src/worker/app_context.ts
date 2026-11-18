/**
 * @fileoverview Type of the per-request context shared by all API routes.
 *
 * Layer: worker (server only).
 *
 * Hono passes a context object through middleware and handlers. This type
 * declares what it carries: the Worker's bindings (`Env`, generated from
 * wrangler.jsonc) and the values the middleware chain in `app.ts` attaches to
 * each request. Route files import it so `c.var.logger` and friends are typed.
 */
import type {Logger} from './lib/logger';
import type {WorkerConfig} from './lib/config';

/** Values the middleware chain attaches to every request. */
export interface RequestVariables {
  /** Unique ID for this request; also sent back in the `X-Request-Id` header. */
  requestId: string;
  /** Logger whose entries all carry this request's ID. */
  logger: Logger;
  /** Validated Worker settings. */
  config: WorkerConfig;
}

/** Hono type parameter for every app and router in the Worker. */
export interface AppContext {
  Bindings: Env;
  Variables: RequestVariables;
}
