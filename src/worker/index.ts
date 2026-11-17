/**
 * @fileoverview Entry point of the Cloudflare Worker.
 *
 * Layer: worker (server only). Named as `main` in wrangler.jsonc.
 *
 * Cloudflare calls the handlers on this module's default export. Only
 * `/api/*` requests reach `fetch`; all other paths are served as static files
 * before any Worker code runs. Scheduled jobs and queue consumers will be
 * added here as `scheduled` and `queue` handlers that call into `jobs/`.
 *
 * The app is created once per isolate and reused across requests. It holds
 * no per-request state, so reuse is safe.
 */
import {createApp} from './app';

/** The API application, shared by every request this isolate handles. */
const app = createApp();

// Workers require a default export; this is the one place it's used for that.
export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
