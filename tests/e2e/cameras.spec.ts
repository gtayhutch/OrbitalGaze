/**
 * @fileoverview End-to-end tests for the camera layer.
 *
 * Layer: end-to-end tests (a real Chromium against the production build and
 * the seeded local database).
 *
 * Pins are drawn on a WebGL canvas, which tests can't click reliably, so
 * cameras are opened through their link (`?camera=<id>`), the same path a
 * shared URL takes. Which camera to open is read from the API, so the tests
 * don't depend on the seed's exact contents.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test, type APIRequestContext} from '@playwright/test';

/** How long the globe may take to finish loading its first tiles, in milliseconds. */
const GLOBE_READY_TIMEOUT_MS = 30_000;

/** Returns the ID and title of the first online camera in the index. */
async function firstCamera(
  request: APIRequestContext,
): Promise<{id: string; title: string}> {
  const index = (await (await request.get('/api/v1/cameras/index')).json()) as {
    data: {cameras: Array<{id: string}>};
  };
  const id = index.data.cameras[0]?.id;
  if (id === undefined) {
    throw new Error('The test database has no cameras. Run `pnpm db:seed`.');
  }
  const detail = (await (
    await request.get(`/api/v1/cameras/${id}`)
  ).json()) as {
    data: {title: string};
  };
  return {id, title: detail.data.title};
}

test('a camera link opens its details, and Escape closes them', async ({
  page,
  request,
}) => {
  const camera = await firstCamera(request);
  await page.goto(`/?camera=${camera.id}`);

  const panel = page.getByRole('complementary', {name: camera.title});
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Preview not available')).toBeVisible();
  await expect(panel.getByText('OrbitalGaze test data')).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(panel).toBeHidden();
  expect(new URL(page.url()).searchParams.has('camera')).toBe(false);
});

test('an unknown camera link explains that it is unavailable', async ({
  page,
}) => {
  await page.goto('/?camera=no-such-camera');

  await expect(
    page.getByRole('complementary', {name: "This camera isn't available"}),
  ).toBeVisible();
});

test('category filters change how many cameras are shown', async ({page}) => {
  await page.goto('/');
  const layers = page.getByRole('region', {name: 'Layers'});
  const shown = layers.getByText(/\d[\d,]* shown/);
  await expect(shown).toBeVisible();
  const before = Number((await shown.innerText()).replace(/\D/g, ''));

  await layers.getByRole('checkbox', {name: /^City/}).click();

  await expect(shown).not.toHaveText(`${before.toLocaleString('en-US')} shown`);
  const after = Number((await shown.innerText()).replace(/\D/g, ''));
  expect(after).toBeLessThan(before);
});

test('the camera panels have no detectable accessibility violations', async ({
  page,
  request,
}) => {
  const camera = await firstCamera(request);
  await page.goto(`/?camera=${camera.id}`);
  await expect(page.locator('[data-globe-status="ready"]')).toBeVisible({
    timeout: GLOBE_READY_TIMEOUT_MS,
  });
  await expect(
    page.getByRole('complementary', {name: camera.title}),
  ).toBeVisible();

  const results = await new AxeBuilder({page})
    .include('header')
    .include('section[aria-label="Layers"]')
    .include('aside')
    .include('[aria-label="Globe view controls"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
