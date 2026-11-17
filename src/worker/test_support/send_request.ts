/**
 * @fileoverview Test helper: sends requests to the Worker's real entry point.
 *
 * Layer: worker test support (runs inside workerd during `pnpm test` only).
 *
 * Requests go through `index.ts` with the local bindings, exactly as
 * Cloudflare would deliver them, so tests cover routing, the middleware
 * chain, and the handlers together.
 */
import {createExecutionContext, waitOnExecutionContext} from 'cloudflare:test';
import {env} from 'cloudflare:workers';

import worker from '../index';

/** Origin used for test requests; any origin works inside the test runtime. */
export const TEST_ORIGIN = 'https://orbitalgaze.test';

/**
 * Sends a request to the Worker and waits for any background work it started
 * (such as cache writes), so tests see a settled state.
 *
 * @param request The request to send.
 * @returns The Worker's response.
 */
export async function sendRequest(request: Request): Promise<Response> {
  const context = createExecutionContext();
  const response = await worker.fetch(request, env, context);
  await waitOnExecutionContext(context);
  return response;
}

/**
 * Sends a GET request for `path`.
 *
 * @param path Path and query, for example `/api/v1/health`.
 * @param headers Extra request headers.
 * @returns The Worker's response.
 * @example
 * const response = await getPath('/api/v1/cameras/index');
 */
export async function getPath(
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return sendRequest(new Request(`${TEST_ORIGIN}${path}`, {headers}));
}
