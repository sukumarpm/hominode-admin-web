import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
});
test('visitor loading, empty and read failures remain explicit', async ({ page }) => {
  await page.goto('/visitors?state=loading');
  await expect(page.getByRole('status', { name: 'Loading information' })).toBeVisible();
  await page.goto('/visitors?state=empty');
  await expect(page.getByText(/Nothing here|No records|No visitors/i).first()).toBeVisible();
  await page.goto('/visitors?state=error');
  await expect(
    page.getByText('Information is temporarily unavailable. Please try again.'),
  ).toBeVisible();
});
for (const width of [393, 600, 800, 1440]) {
  test(`policy settings and decision confirmation fit ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/__visitor-policy-test');
    await expect(page.getByText('Visitor Approval Settings', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Emergency start')).toHaveValue('2026-11-09T08:00');
    await page.getByLabel('Approval policy').selectOption('all_approval_required');
    await page.getByRole('button', { name: 'Save visitor settings' }).click();
    await expect(page.getByText(/Visitor settings saved and reloaded/)).toBeVisible();
    await page.getByRole('button', { name: 'Approve visitor', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Confirm visitor decision' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm approve', exact: true }).click();
    await expect(page.getByText('Decision confirmed by the server.')).toBeVisible();
    expect(errors).toEqual([]);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      offenders: Array.from(document.querySelectorAll('body *'))
        .map((el) => ({
          tag: el.tagName,
          cls: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
        }))
        .filter((el) => el.right > innerWidth + 1 && el.width > 1)
        .slice(0, 12),
    }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  });
  test(`existing Visitors route partitions all queues at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.goto('/visitors');
    await page.getByRole('tab', { name: /Pending approval/ }).click();
    await expect(page.getByText('Pending Policy Guest', { exact: true })).toBeVisible();
    await expect(page.getByText('Rohit Sharma', { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /Expected \/ authorized/ }).click();
    await expect(page.getByText('Rohit Sharma', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /Inside/ }).click();
    await expect(page.getByText('Inside Policy Guest', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByText('Denied Policy Guest', { exact: true })).toBeVisible();
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: innerWidth,
      offenders: Array.from(document.querySelectorAll('body *'))
        .map((el) => ({
          tag: el.tagName,
          cls: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
        }))
        .filter((el) => el.right > innerWidth + 1 && el.width > 1)
        .slice(0, 12),
    }));
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport);
  });
}
