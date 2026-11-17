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

test('the globe renders and reports ready', async ({page}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: 'OrbitalGaze'})).toBeVisible();
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });
  await expect(page.locator('canvas')).toBeVisible();
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
  expect(headers['content-security-policy-report-only']).toContain(
    "frame-ancestors 'none'",
  );
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
