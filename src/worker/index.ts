/**
 * @fileoverview Entry point of the Cloudflare Worker.
 *
 * Layer: worker (server only). Named as `main` in wrangler.jsonc.
 *
 * Cloudflare calls the handlers on this module's default export:
 * - `fetch`: only `/api/*` requests reach it; all other paths are served as
 *   static files before any Worker code runs.
 * - `scheduled`: the cron triggers (the camera import plan and finish
 *   steps, and the snapshot layer refresh), handled in `jobs/scheduled.ts`.
 * - `queue`: the camera import queue, handled in `jobs/ingest_queue.ts`.
 *
 * The app is created once per isolate and reused across requests. It holds
 * no per-request state, so reuse is safe.
 */
import {createApp} from './app';
import {handleIngestBatch} from './jobs/ingest_queue';
import {handleScheduled} from './jobs/scheduled';
import {withWorkerErrorReporting} from './lib/error_reporting';

/** The API application, shared by every request this isolate handles. */
const app = createApp();

// Workers require a default export; this is the one place it's used for that.
export default withWorkerErrorReporting({
  fetch: app.fetch,
  scheduled: async (controller, env) => {
    await handleScheduled(controller, env);
  },
  queue: async (batch, env) => {
    await handleIngestBatch(batch, env);
  },
} satisfies ExportedHandler<Env>);
