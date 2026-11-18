/**
 * @fileoverview End-to-end tests for camera search.
 *
 * Layer: end-to-end tests (a real Chromium against the production build and
 * the seeded local database, which has synthetic cameras around Tokyo).
 */
import AxeBuilder from '@axe-core/playwright';
import {expect, test} from '@playwright/test';

test('searching for a city and choosing a result opens that camera', async ({
  page,
}) => {
  await page.goto('/');

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', {name: 'Search cameras'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox').fill('Tokyo');

  const firstResult = dialog.getByRole('option').first();
  await expect(firstResult).toContainText('Tokyo');
  const title = (
    await firstResult.locator('span span').first().innerText()
  ).trim();
  await firstResult.click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('complementary', {name: title})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('camera')).not.toBeNull();
});

test('the search dialog has no detectable accessibility violations', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', {name: /Search places and cameras/}).click();
  const dialog = page.getByRole('dialog', {name: 'Search cameras'});
  await dialog.getByRole('combobox').fill('Tokyo');
  await expect(dialog.getByRole('option').first()).toBeVisible();

  const results = await new AxeBuilder({page})
    .include('[role="dialog"]')
    .analyze();

  expect(results.violations).toEqual([]);
});
