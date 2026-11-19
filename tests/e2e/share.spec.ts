/**
 * @fileoverview End-to-end tests for share links.
 *
 * Layer: end-to-end tests (a real Chromium against the production build).
 *
 * A share link carries the globe's view (`?view=`) and the active layers
 * (`?layers=`). These tests open such links, check that the page follows
 * them, check that the address keeps up with the camera, and copy a link
 * with the "Share this view" button.
 */
import {expect, test} from '@playwright/test';

/** How long the globe may take to finish loading its first tiles, in milliseconds. */
const GLOBE_READY_TIMEOUT_MS = 30_000;

/** A view looking straight down on Tokyo at regional scale (zoom 5). */
const TOKYO_VIEW = '2_139.7454_35.6586_5.00_0.0_0.0';

/** The same place in a link from the earlier globe (2,000 km up). */
const LEGACY_TOKYO_VIEW = '1_139.7454_35.6586_2000000_0.0_-90.0';

/** The browser objects these tests read inside the page. */
interface BrowserGlobals {
  localStorage: {getItem(key: string): string | null};
  navigator: {clipboard: {readText(): Promise<string>}};
}

/** Reads the zoom level from the page's `view` parameter. */
function zoomInUrl(url: string): number {
  const view = new URL(url).searchParams.get('view') ?? '';
  return Number(view.split('_')[3]);
}

test('a link with layers=(empty) opens with the webcam layer off, without saving it', async ({
  page,
}) => {
  await page.goto('/?layers=');

  const webcams = page.getByRole('switch', {name: 'Public webcams'});
  await expect(webcams).not.toBeChecked();
  // The e2e project has no DOM types, so the browser objects are described.
  const savedChoices = await page.evaluate(() =>
    (globalThis as unknown as BrowserGlobals).localStorage.getItem(
      'orbitalgaze.layerChoices',
    ),
  );
  expect(savedChoices).toBeNull();
});

test('a link with a view opens there, and the address follows the camera', async ({
  page,
}) => {
  await page.goto(`/?view=${TOKYO_VIEW}`);
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  await page.getByRole('button', {name: 'Zoom in'}).click();

  // Zooming in adds one level; the address is rewritten once it settles.
  await expect.poll(() => zoomInUrl(page.url())).toBeCloseTo(6, 1);
  expect(page.url()).toContain('view=2_139.7454_35.6586_');
});

test('a link from the earlier globe still opens on the same place', async ({
  page,
}) => {
  await page.goto(`/?view=${LEGACY_TOKYO_VIEW}`);
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  // The first settled view is written in the new format: about zoom 5.5.
  await page.getByRole('button', {name: 'Zoom out'}).click();
  await expect.poll(() => page.url()).toContain('view=2_139.7454_35.6586_');
  expect(zoomInUrl(page.url())).toBeCloseTo(4.55, 1);
});

test('"Share this view" copies a link with the view and the active layers', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/?view=${TOKYO_VIEW}`);
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  await page.getByRole('button', {name: 'Share this view'}).click();

  await expect(
    page.getByRole('status').filter({hasText: 'Link copied'}),
  ).toBeVisible();
  const copied = await page.evaluate(() =>
    (globalThis as unknown as BrowserGlobals).navigator.clipboard.readText(),
  );
  const link = new URL(copied);
  expect(link.searchParams.get('layers')).toBe('webcams');
  expect(link.searchParams.get('view')).toMatch(/^2_139\.\d+_35\.\d+_/);
});
