/**
 * @fileoverview End-to-end tests for the map style switch (dark map or satellite).
 *
 * Layer: end-to-end tests (a real Chromium against the production build).
 *
 * Imagery tiles are answered in the browser with a tiny stand-in image, so
 * no test reaches NASA; what's checked is that the globe asks our own
 * origin for them, credits NASA, keeps the choice in the URL, and breaks no
 * security policy.
 */
import {expect, test} from '@playwright/test';

/** How long the globe may take to finish loading, in milliseconds. */
const GLOBE_READY_TIMEOUT_MS = 30_000;

/** A 1×1 JPEG. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);

/** The page's window, as the CSP check uses it inside the browser. */
interface CspRecordingWindow {
  cspReports: string[];
  addEventListener(
    type: 'securitypolicyviolation',
    listener: (event: {effectiveDirective: string; blockedURI: string}) => void,
  ): void;
}

test('switching to satellite loads imagery from our origin and keeps it in the link', async ({
  page,
}) => {
  const imageryPaths: string[] = [];
  await page.context().route('**/api/v1/imagery/**', route => {
    imageryPaths.push(new URL(route.request().url()).pathname);
    return route.fulfill({contentType: 'image/jpeg', body: TINY_JPEG});
  });
  await page.addInitScript(() => {
    const browserWindow = globalThis as unknown as CspRecordingWindow;
    browserWindow.cspReports = [];
    browserWindow.addEventListener('securitypolicyviolation', event => {
      browserWindow.cspReports.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
  await page.goto('/');
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  // Step 1: switch styles from the layer panel (visitors click the label;
  // the radio itself is visually hidden).
  const panel = page.getByRole('region', {name: 'Layers'});
  await panel.getByText('Satellite', {exact: true}).click();
  await expect(page.getByRole('radio', {name: 'Satellite'})).toBeChecked();

  // Step 2: tiles come from our own imagery route, and NASA is credited.
  await expect.poll(() => imageryPaths.length).toBeGreaterThan(0);
  expect(
    imageryPaths.every(path =>
      /^\/api\/v1\/imagery\/bluemarble\/\d+\/\d+\/\d+\.jpg$/.test(path),
    ),
  ).toBe(true);
  await expect(page.getByRole('link', {name: 'NASA GIBS'})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('map')).toBe('satellite');

  // Step 3: back to the dark map; the credit and the link value go away.
  await panel.getByText('Dark map', {exact: true}).click();
  await expect(page.getByRole('link', {name: 'NASA GIBS'})).toBeHidden();
  expect(new URL(page.url()).searchParams.get('map')).toBeNull();

  const reports = await page.evaluate(
    () => (globalThis as unknown as CspRecordingWindow).cspReports,
  );
  expect(reports).toEqual([]);
});

test('a link with ?map=satellite opens in the satellite style', async ({
  page,
}) => {
  await page
    .context()
    .route('**/api/v1/imagery/**', route =>
      route.fulfill({contentType: 'image/jpeg', body: TINY_JPEG}),
    );
  await page.goto('/?map=satellite');

  await expect(page.getByRole('radio', {name: 'Satellite'})).toBeChecked({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });
  await expect(page.getByRole('link', {name: 'NASA GIBS'})).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });
});
