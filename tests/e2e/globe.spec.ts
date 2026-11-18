/**
 * @fileoverview End-to-end smoke tests for the globe page.
 *
 * Layer: end-to-end tests (a real Chromium against the production build).
 *
 * These confirm the pieces that unit tests can't: the Cesium runtime files are
 * served from our origin, WebGL starts, the API answers through the Worker,
 * static files carry their security headers, and the interface has no
 * automatically detectable accessibility problems.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

/** How long the globe may take to finish loading its first tiles, in milliseconds. */
const GLOBE_READY_TIMEOUT_MS = 30_000;

/** The page's window, as the CSP report test uses it inside the browser. */
interface CspRecordingWindow {
  /** Each report as "<directive> <blocked URI>", e.g. "script-src eval". */
  cspReports: string[];
  /** The window's `addEventListener`, narrowed to CSP reports. */
  addEventListener(
    type: 'securitypolicyviolation',
    listener: (event: {effectiveDirective: string; blockedURI: string}) => void,
  ): void;
}

test('the globe renders and reports ready', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: 'OrbitalGaze'})).toBeVisible();
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });
  await expect(page.locator('canvas')).toBeVisible();
});

test("Cesium's runtime files are served from our origin", async ({request}) => {
  // Cesium loads these from CESIUM_BASE_URL at run time. If the build copies
  // them anywhere else, the app's fallback page is served instead and the
  // globe never finishes loading.
  const worker = await request.get('/cesium/Workers/transferTypedArrayTest.js');
  expect(worker.status()).toBe(200);
  expect(worker.headers()['content-type']).toContain('javascript');

  const asset = await request.get(
    '/cesium/Assets/approximateTerrainHeights.json',
  );
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('json');
});

test('the local environment badge comes from the API', async ({page}) => {
  await page.goto('/');

  await expect(page.getByText('Local', {exact: true})).toBeVisible();
});

test('the app page carries the static security headers', async ({request}) => {
  const response = await request.get('/');
  const headers = response.headers();

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  const csp = headers['content-security-policy-report-only'];
  expect(csp).toContain("frame-ancestors 'none'");
  // Windy images and players load only from Windy's own hosts.
  expect(csp).toContain('img-src');
  expect(csp).toContain('https://imgproxy.windy.com');
  expect(csp).toContain('frame-src https://webcams.windy.com;');
});

test('loading the globe never evaluates strings as code', async ({page}) => {
  // Step 1: record every Content Security Policy report from the very first
  // script on. The policy is report-only, so a violation shows up only as
  // this event, not as an error.
  await page.addInitScript(() => {
    // The e2e project has no DOM types, so describe the bits used here.
    // Reports fired at the document bubble up to the window.
    const browserWindow = globalThis as unknown as CspRecordingWindow;
    browserWindow.cspReports = [];
    browserWindow.addEventListener('securitypolicyviolation', event => {
      browserWindow.cspReports.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });

  // Step 2: load the page and let the globe and the camera index finish.
  // That loads all of Cesium and parses API responses with Zod, the two
  // places that used to evaluate strings.
  await page.goto('/');
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  // Step 3: no report may be about string evaluation (eval, new Function).
  const reports = await page.evaluate(
    () => (globalThis as unknown as CspRecordingWindow).cspReports,
  );
  expect(reports.filter(report => report.endsWith(' eval'))).toEqual([]);
});

test('the interface overlays have no detectable accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  // The Cesium canvas and its credit strip are third-party markup; check our
  // own interface.
  const results = await new AxeBuilder({page}).include('header').analyze();

  expect(results.violations).toEqual([]);
});
