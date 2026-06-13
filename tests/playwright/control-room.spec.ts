import { test, expect } from '@playwright/test';

// Real-Chromium smoke for the control room. CI-only (needs a browser binary).
test('control room loads, hydrates the queue, and triages a case', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('RevenueTwin')).toBeVisible();
  // queue hydrates from the live API (seeded portfolio has the Northwind Work IQ leak)
  const cards = page.locator('[data-case-id]');
  await expect(cards.first()).toBeVisible();
  // recall bar shows blind-vs-sighted 0% / 100%
  await expect(page.getByTestId('recall-on')).toHaveText('100%');
  // open a case -> inspector populates
  await cards.first().click();
  await expect(page.getByTestId('inspector')).not.toBeEmpty();
});

test('CFO dashboard tab renders headline stats', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tab-dashboard').click();
  await expect(page.getByText('CFO Dashboard')).toBeVisible();
  await expect(page.getByTestId('dash-total')).toBeVisible();
});
