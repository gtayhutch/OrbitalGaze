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
 * Something that answers requests like the Worker's `fetch` handler: the real
 * entry point by default, or an app built with test options (for example
 * `createApp({snapshotSources: [fake]}).fetch`).
 */
export type FetchHandler = (
  request: Request,
  bindings: Env,
  context: ExecutionContext,
) => Response | Promise<Response>;

/**
 * Sends a request to the Worker and waits for any background work it started
 * (such as cache writes), so tests see a settled state.
 *
 * @param request The request to send.
 * @param bindings The bindings to run with. Defaults to the test bindings;
 *     tests pass a copy with changes, such as a secret set.
 * @param handler What answers the request. Defaults to the Worker's entry
 *     point.
 * @returns The Worker's response.
 */
export async function sendRequest(
  request: Request,
  bindings: Env = env,
  handler: FetchHandler = worker.fetch,
): Promise<Response> {
  const context = createExecutionContext();
  const response = await handler(request, bindings, context);
  await waitOnExecutionContext(context);
  return response;
}

/**
 * Sends a GET request for `path`.
 *
 * @param path Path and query, for example `/api/v1/health`.
 * @param headers Extra request headers.
 * @param bindings The bindings to run with (see {@link sendRequest}).
 * @param handler What answers the request (see {@link sendRequest}).
 * @returns The Worker's response.
 * @example
 * const response = await getPath('/api/v1/cameras/index');
 */
export async function getPath(
  path: string,
  headers: Record<string, string> = {},
  bindings: Env = env,
  handler?: FetchHandler,
): Promise<Response> {
  return sendRequest(
    new Request(`${TEST_ORIGIN}${path}`, {headers}),
    bindings,
    handler,
  );
}
