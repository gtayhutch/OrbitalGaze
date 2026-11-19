/**
 * @fileoverview End-to-end tests for the satellites layer.
 *
 * Layer: end-to-end tests (a real Chromium against the production build).
 *
 * The snapshot is replaced by three real-format satellites whose elements
 * are dated "now", so their positions are valid whenever the test runs. The
 * orbit worker fetches it like the real one, so this covers the worker,
 * the deck.gl overlay loading on demand, search, the detail panel, links,
 * the Content Security Policy, and accessibility.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

/** How long the globe may take to finish loading, in milliseconds. */
const GLOBE_READY_TIMEOUT_MS = 30_000;

/** The current moment as an OMM epoch (UTC, no zone suffix). */
function ommEpochNow(): string {
  return new Date().toISOString().replace('Z', '');
}

/** Three satellites: the ISS, Hubble, and a geostationary one. */
function fixtureSnapshot(): unknown {
  const epoch = ommEpochNow();
  const common = {
    epoch,
    bstar: 0.0002,
    meanMotionDot: 0.0001,
    meanMotionDdot: 0,
    revAtEpoch: 1000,
    elementSetNo: 999,
  };
  return {
    data: {
      layerId: 'satellites',
      checkedAt: new Date().toISOString(),
      items: [
        {
          ...common,
          id: 20580,
          name: 'HST',
          intlDes: '1990-037B',
          group: 'science',
          meanMotion: 15.29,
          eccentricity: 0.0002,
          inclination: 28.47,
          raan: 120,
          argPericenter: 80,
          meanAnomaly: 10,
        },
        {
          ...common,
          id: 25544,
          name: 'ISS (ZARYA)',
          intlDes: '1998-067A',
          group: 'stations',
          meanMotion: 15.5,
          eccentricity: 0.0004,
          inclination: 51.63,
          raan: 196.8,
          argPericenter: 73.2,
          meanAnomaly: 286.9,
        },
        {
          ...common,
          id: 26824,
          name: 'INTELSAT 901',
          intlDes: '2001-024A',
          group: 'geostationary',
          meanMotion: 1.0027,
          eccentricity: 0.0002,
          inclination: 0.05,
          raan: 90,
          argPericenter: 200,
          meanAnomaly: 40,
          bstar: 0,
          meanMotionDot: 0,
        },
      ],
    },
  };
}

/** The page's window, as the CSP check uses it inside the browser. */
interface CspRecordingWindow {
  cspReports: string[];
  addEventListener(
    type: 'securitypolicyviolation',
    listener: (event: {effectiveDirective: string; blockedURI: string}) => void,
  ): void;
}

/** Serves the fixture snapshot to the page and its orbit worker. */
async function stubSnapshot(page: Page): Promise<void> {
  await page
    .context()
    .route('**/api/v1/layers/satellites', route =>
      route.fulfill({json: fixtureSnapshot()}),
    );
}

test('the satellites layer loads, and search opens a satellite', async ({
  page,
}) => {
  await stubSnapshot(page);
  await page.addInitScript(() => {
    const browserWindow = globalThis as unknown as CspRecordingWindow;
    browserWindow.cspReports = [];
    browserWindow.addEventListener('securitypolicyviolation', event => {
      browserWindow.cspReports.push(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
  await page.goto('/?layers=');
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  // Step 1: switch the layer on; its count and credit appear.
  await page.getByRole('switch', {name: 'Satellites'}).click();
  await expect(page.getByText('3 shown')).toBeVisible();
  await expect(page.getByRole('link', {name: 'CelesTrak'})).toBeVisible();

  // Step 2: search finds the ISS and opens its live details.
  await page.getByRole('button', {name: /Search places and cameras/}).click();
  await page.getByPlaceholder(/Search a city/).fill('iss');
  await page.getByRole('option', {name: /ISS \(ZARYA\)/}).click();
  const panel = page.getByRole('complementary', {name: 'ISS (ZARYA)'});
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Space stations')).toBeVisible();
  await expect(panel.getByText(/^\d{3} km$/)).toBeVisible();
  await expect(panel.getByText('Low Earth orbit')).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('satellite'))
    .toBe('25544');

  // Step 3: nothing the layer loads breaks the security policy.
  const reports = await page.evaluate(
    () => (globalThis as unknown as CspRecordingWindow).cspReports,
  );
  expect(reports).toEqual([]);

  // Step 4: closing the panel clears the selection.
  await panel.getByRole('button', {name: 'Close satellite details'}).click();
  await expect(panel).toBeHidden();
  expect(new URL(page.url()).searchParams.get('satellite')).toBeNull();
});

test('a link to a satellite switches the layer on and opens it', async ({
  page,
}) => {
  await stubSnapshot(page);
  await page.goto('/?layers=&satellite=26824');

  const panel = page.getByRole('complementary', {name: 'INTELSAT 901'});
  await expect(panel).toBeVisible({timeout: GLOBE_READY_TIMEOUT_MS});
  await expect(panel.getByText('Geosynchronous orbit')).toBeVisible();
  await expect(page.getByRole('switch', {name: 'Satellites'})).toBeChecked();
});

test('the satellite panels have no detectable accessibility violations', async ({
  page,
}) => {
  await stubSnapshot(page);
  await page.goto('/?layers=satellites&satellite=20580');
  await expect(page.getByRole('complementary', {name: 'HST'})).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });

  const results = await new AxeBuilder({page})
    .include('[aria-label="Layers"]')
    .include('aside[aria-labelledby="satellite-detail-title"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
