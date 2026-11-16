import { test, expect } from '@playwright/test';
import { APP_ROLE } from '../src/role';
test.skip(APP_ROLE !== 'admin', 'Admin moderation only');
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
});
for (const width of [360, 768, 1440])
  for (const count of [0, 3, 10, 100, 1001]) {
    test(`moderation ${count} records at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/community?moderationCount=${count}`);
      const moderation = page.getByRole('region', { name: 'Content moderation' });
      await expect(moderation.getByRole('button', { name: 'View all history' })).toBeVisible();
      await expect(moderation.getByRole('article')).toHaveCount(Math.min(count, 3) * 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await moderation.getByRole('button', { name: 'View all history' }).click();
      await expect(moderation.getByRole('article')).toHaveCount(Math.min(count, 10));
      await expect(moderation.getByRole('button', { name: 'Previous' })).toBeDisabled();
      if (count > 10) {
        await moderation.getByRole('button', { name: 'Next' }).click();
        await expect(moderation.getByText(`Page 2 · 10 shown · ${count} available`)).toBeVisible();
        await expect(moderation.getByRole('article')).toHaveCount(10);
        await moderation.getByRole('button', { name: 'Previous' }).click();
      } else await expect(moderation.getByRole('button', { name: 'Next' })).toBeDisabled();
      await moderation.getByLabel('Search history').fill('hide');
      await moderation.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        moderation.getByText(`${Math.ceil(count / 2)} decisions matching search`),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await moderation.getByRole('button', { name: 'Back to overview' }).click();
      await moderation.getByRole('button', { name: 'View all reports' }).click();
      await expect(moderation.getByRole('article')).toHaveCount(Math.min(count, 10));
      if (count > 0) {
        await moderation.getByRole('button', { name: 'Dismiss report' }).first().click();
        await page.getByLabel('Public decision reason').selectOption('no_violation');
        await page.getByRole('button', { name: 'Confirm decision' }).click();
        await expect(moderation.getByText(`${count - 1} open`, { exact: true })).toBeVisible();
        await expect(moderation.getByRole('article')).toHaveCount(Math.min(count - 1, 10));
      }
    });
  }
test('moderation errors support retry', async ({ page }) => {
  await page.goto('/community?moderationCount=0&moderationState=error');
  const moderation = page.getByRole('region', { name: 'Content moderation' });
  await expect(moderation.getByRole('alert')).toContainText('Synthetic moderation error');
  await moderation.getByRole('button', { name: 'Retry' }).click();
  await expect(moderation.getByText('No open reports.')).toBeVisible();
});
