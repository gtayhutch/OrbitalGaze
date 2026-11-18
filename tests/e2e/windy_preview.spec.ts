/**
 * @fileoverview End-to-end tests for Windy camera previews and the credit.
 *
 * Layer: end-to-end tests (a real Chromium against the production build and
 * the seeded local database).
 *
 * CI has no Windy key and must never call Windy, so the browser's requests
 * are intercepted at the network boundary: a seeded camera's details are
 * marked as having a feed, its feed route answers with Windy-style links,
 * and the image host serves a tiny local image. Everything else (the app,
 * the API, the globe) is real.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test, type Page} from '@playwright/test';

/** A 1×1 PNG, served in place of Windy's image. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/** The links the fake feed returns. */
const FEED = {
  kind: 'windy',
  imageUrl:
    'https://imgproxy.windy.com/_/preview/plain/current/1/original.jpg?token=e2e',
  imageWidth: 400,
  imageHeight: 224,
  pageUrl: 'https://windy.com/webcams/1',
  timelapseUrl: 'https://webcams.windy.com/webcams/public/embed/player/1/day',
  liveUrl: null,
  expiresAt: new Date(Date.now() + 9 * 60 * 1000).toISOString(),
};

/**
 * Makes the first camera in the index look like a Windy camera, and returns
 * its ID and title.
 */
async function fakeWindyCamera(
  page: Page,
): Promise<{id: string; title: string}> {
  const index = (await (
    await page.request.get('/api/v1/cameras/index')
  ).json()) as {data: {cameras: Array<{id: string}>}};
  const id = index.data.cameras[0]?.id;
  if (id === undefined) {
    throw new Error('The test database has no cameras. Run `pnpm db:seed`.');
  }

  // The real detail response, with `hasFeed` switched on.
  await page.route(`**/api/v1/cameras/${id}`, async route => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      data: {title: string; hasFeed: boolean};
    };
    body.data.hasFeed = true;
    await route.fulfill({response, json: body});
  });
  await page.route(`**/api/v1/cameras/${id}/feed`, route =>
    route.fulfill({json: {data: FEED}}),
  );
  await page.route('https://imgproxy.windy.com/**', route =>
    route.fulfill({contentType: 'image/png', body: PIXEL_PNG}),
  );
  // The player must never load unless the visitor asks for it.
  await page.route('https://webcams.windy.com/**', route =>
    route.fulfill({contentType: 'text/html', body: '<p>Fake player</p>'}),
  );

  const detail = (await (
    await page.request.get(`/api/v1/cameras/${id}`)
  ).json()) as {data: {title: string}};
  return {id, title: detail.data.title};
}

test('a Windy camera shows its latest image, linked to windy.com, and the player on request', async ({
  page,
}) => {
  const playerRequests: string[] = [];
  page.on('request', request => {
    if (request.url().startsWith('https://webcams.windy.com/')) {
      playerRequests.push(request.url());
    }
  });
  const camera = await fakeWindyCamera(page);

  await page.goto(`/?camera=${camera.id}`);

  const panel = page.getByRole('complementary', {name: camera.title});
  const image = panel.getByRole('img', {
    name: `Latest image from ${camera.title}`,
  });
  await expect(image).toBeVisible();
  await expect(image.locator('xpath=ancestor::a')).toHaveAttribute(
    'href',
    FEED.pageUrl,
  );
  expect(playerRequests).toEqual([]);

  await panel.getByRole('button', {name: "Watch today's timelapse"}).click();

  await expect(
    panel.getByTitle(`Timelapse of ${camera.title}`),
  ).toHaveAttribute('src', FEED.timelapseUrl);
  await expect.poll(() => playerRequests.length).toBeGreaterThan(0);
});

test('the Windy credit is always visible, also above the phone bottom sheet', async ({
  page,
}) => {
  const camera = await fakeWindyCamera(page);
  const credit = page.getByText('Webcams provided by');

  await page.goto('/');
  await expect(credit).toBeVisible();

  await page.setViewportSize({width: 390, height: 844});
  await page.goto(`/?camera=${camera.id}`);
  const sheet = page.getByRole('complementary', {name: camera.title});
  await expect(sheet).toBeVisible();
  await expect(credit).toBeVisible();

  // The credit sits above the sheet, not underneath it.
  const creditBox = await credit.boundingBox();
  const sheetBox = await sheet.boundingBox();
  expect(creditBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  if (creditBox !== null && sheetBox !== null) {
    expect(creditBox.y + creditBox.height).toBeLessThanOrEqual(sheetBox.y);
  }
});

test('the Windy preview has no detectable accessibility violations', async ({
  page,
}) => {
  const camera = await fakeWindyCamera(page);
  await page.goto(`/?camera=${camera.id}`);
  const panel = page.getByRole('complementary', {name: camera.title});
  await expect(panel.getByRole('img')).toBeVisible();

  const results = await new AxeBuilder({page}).include('aside').analyze();

  expect(results.violations).toEqual([]);
});
