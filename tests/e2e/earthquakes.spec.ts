/**
 * @fileoverview Exercises the earthquake layer in a real browser using a
 * fixed snapshot so current USGS activity cannot change the assertions.
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

test('opens earthquake details and flies to the epicentre with the keyboard', async ({
  page,
}) => {
  await page.route('**/api/v1/layers/earthquakes', route =>
    route.fulfill({
      json: {
        data: {
          layerId: 'earthquakes',
          checkedAt: '2026-11-18T10:05:00Z',
          items: [
            {
              id: 'test-quake',
              place: 'Near the coast',
              occurredAt: '2026-11-18T10:01:00Z',
              magnitude: 4.2,
              depthKm: 12,
              lat: 40,
              lng: -120,
            },
          ],
        },
      },
    }),
  );
  await page.goto('/');
  const toggle = page.getByRole('switch', {name: 'Earthquakes'});
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await toggle.press('Space');

  const event = page.getByRole('button', {name: /M 4.2 Near the coast/});
  await expect(event).toBeVisible();
  await event.focus();
  await event.press('Enter');
  await expect(event).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/12.0 km depth/)).toBeVisible();
  await expect(
    page.getByRole('link', {name: 'USGS Earthquake Hazards Program'}),
  ).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('view'), {
      timeout: 15_000,
    })
    .toMatch(/^2_-120\.\d+_40\.\d+_/);

  const result = await new AxeBuilder({page})
    .include('[aria-label="Layers"]')
    .analyze();
  expect(result.violations).toEqual([]);
});
