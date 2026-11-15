import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Offline fixtures only: no production Firestore reads or writes.
  await page.route('https://**/*', (route) => route.abort());
});

for (const width of [393, 600, 800, 1440]) {
  test(`notification inbox fits at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/notifications');
    expect(errors).toEqual([]);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    const card = page.getByRole('article', { name: 'Security request: Registered phone number' });
    await expect(card.getByText('Security support request', { exact: true })).toBeVisible();
    await expect(card.locator('.notification-message')).toContainText(
      'Please update my registered phone number',
    );
    await expect(card.locator('.notification-reference')).toHaveText(
      'Reference: HSP-AAAAAAAAAAAAAAAAAAAAAAAA',
    );
    await expect(card.getByRole('button', { name: 'Mark as read' })).toBeVisible();
    await expect(page.getByText('A visitor is waiting for approval.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await card.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return Array.from(element.querySelectorAll('h2, p, time, button')).every((child) => {
          const rect = child.getBoundingClientRect();
          return (
            rect.left >= bounds.left &&
            rect.right <= bounds.right + 1 &&
            rect.bottom <= bounds.bottom + 1
          );
        });
      }),
    ).toBe(true);
  });
}
