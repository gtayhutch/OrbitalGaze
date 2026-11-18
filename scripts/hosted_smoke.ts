/**
 * @fileoverview Read-only post-deployment checks for staging and production.
 * Cloudflare publishes independently of Actions, so this script waits for
 * the expected build revision before examining any deployed behaviour.
 */
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

/** Only the documented public environments may be probed. */
const HOSTS = {
  staging: 'https://staging.orbitalgaze.com',
  production: 'https://orbitalgaze.com',
} as const;

/** Hosted environment supplied by the protected branch name. */
type Environment = keyof typeof HOSTS;

/** Maximum time to wait for the concurrent Workers Builds deploy. */
const DEPLOY_TIMEOUT_MS = 15 * 60_000;

/** A gentle interval between read-only health probes. */
const PROBE_INTERVAL_MS = 15_000;

/** Bounds a slow individual HTTP request. */
const HTTP_TIMEOUT_MS = 10_000;

/** GET with a deadline and optional redirect handling. */
function read(
  url: string,
  redirect: 'follow' | 'manual' = 'follow',
): Promise<Response> {
  return fetch(url, {redirect, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)});
}

/** Waits for the exact revision and validates the environment health body. */
async function awaitDeploy(
  environment: Environment,
  revision: string,
): Promise<void> {
  const deadline = Date.now() + DEPLOY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await read(`${HOSTS[environment]}/api/v1/health`).catch(
      () => null,
    );
    if (
      response?.ok &&
      response.headers.get('X-OrbitalGaze-Revision') === revision
    ) {
      const data: unknown = await response.json();
      assert.deepEqual(data, {data: {status: 'ok', environment}});
      return;
    }
    await response?.body?.cancel();
    await delay(PROBE_INTERVAL_MS);
  }
  throw new Error(
    'The expected revision did not become healthy before the timeout.',
  );
}

/** Verifies public application, API, and environment-specific behavior. */
async function smoke(
  environment: Environment,
  revision: string,
): Promise<void> {
  const host = HOSTS[environment];
  await awaitDeploy(environment, revision);
  const [page, index, unknownLayer] = await Promise.all([
    read(`${host}/`),
    read(`${host}/api/v1/cameras/index`),
    read(`${host}/api/v1/layers/unknown`),
  ]);

  assert.equal(page.status, 200);
  assert.match(page.headers.get('Content-Type') ?? '', /^text\/html/);
  assert.ok(
    page.headers.has('Content-Security-Policy') ||
      page.headers.has('Content-Security-Policy-Report-Only'),
    'The page did not send a browser security policy.',
  );
  await page.body?.cancel();

  assert.equal(index.status, 200);
  const payload: unknown = await index.json();
  assert.ok(
    typeof payload === 'object' && payload !== null && 'data' in payload,
  );
  const data = payload.data;
  assert.ok(typeof data === 'object' && data !== null && 'cameras' in data);
  assert.ok(
    Array.isArray(data.cameras) && data.cameras.length > 0,
    'The deployed camera index is empty or invalid.',
  );
  assert.equal(unknownLayer.status, 404);
  await unknownLayer.body?.cancel();

  if (environment === 'staging') {
    assert.match(page.headers.get('X-Robots-Tag') ?? '', /\bnoindex\b/);
  } else {
    const redirect = await read(
      'https://www.orbitalgaze.com/?layers=webcams',
      'manual',
    );
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('Location'), `${host}/?layers=webcams`);
    await redirect.body?.cancel();
  }
}

const [, , environment, revision] = process.argv;
assert.ok(environment === 'staging' || environment === 'production');
assert.ok(typeof revision === 'string' && /^[a-f0-9]{40}$/.test(revision));
await smoke(environment, revision);
console.log(`Hosted smoke checks passed for ${environment} at ${revision}.`);
