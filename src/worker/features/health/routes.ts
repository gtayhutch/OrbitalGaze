/**
 * @fileoverview Routes for the health feature: `GET /api/v1/health`.
 *
 * Layer: worker route (server only).
 *
 * The health endpoint tells monitoring (and the browser app) that the Worker
 * is up and which environment answered. It touches no database or outside
 * service, so it stays fast and cheap, and it reveals nothing beyond the
 * environment name, which the site already shows outside production.
 */
import {Hono} from 'hono';

import type {HealthResponse} from '@/shared/api/health';

import type {AppContext} from '../../app_context';

/** Git commit SHA injected by Workers Builds; absent in the test runtime. */
declare const ORBITALGAZE_DEPLOY_REVISION: string;

/**
 * Router for the health feature, mounted at `/api/v1/health` in `app.ts`.
 *
 * `GET /` responds 200 with `{data: {status: "ok", environment}}`.
 */
export const healthRoutes = new Hono<AppContext>().get('/', c => {
  if (
    typeof ORBITALGAZE_DEPLOY_REVISION === 'string' &&
    /^[a-f0-9]{40}$/.test(ORBITALGAZE_DEPLOY_REVISION)
  ) {
    c.header('X-OrbitalGaze-Revision', ORBITALGAZE_DEPLOY_REVISION);
  }
  const body: HealthResponse = {
    status: 'ok',
    environment: c.var.config.appEnvironment,
  };
  return c.json({data: body});
});
