import { test, expect } from '@playwright/test';
import { APP_ROLE } from '../src/role';
const base = APP_ROLE === 'resident' ? '/green-valley/' : '/';
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', (route) => route.abort());
});
test('shell persists through SPA navigation, browser history and direct refresh', async ({
  page,
}) => {
  await page.goto(base + 'visitors');
  await expect(page.getByRole('heading', { name: 'Visitors', level: 1 })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { savedShell: Element | null; savedSidebar: Element | null };
    w.savedShell = document.querySelector('[data-testid="app-shell"]');
    w.savedSidebar = document.querySelector('.sidebar');
  });
  await page.locator('.sidebar').getByRole('link', { name: 'Complaints', exact: true }).click();
  await expect(page).toHaveURL(base + 'complaints');
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { savedShell: Element; savedSidebar: Element };
      return (
        w.savedShell === document.querySelector('[data-testid="app-shell"]') &&
        w.savedSidebar === document.querySelector('.sidebar')
      );
    }),
  ).toBe(true);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Visitors', level: 1 })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Complaints', level: 1 })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Complaints', level: 1 })).toBeVisible();
});
for (const width of [360, 390, 430, 768, 1024, 1280, 1440, 1920])
  test('responsive dashboard at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    await page.goto(base + (APP_ROLE === 'admin' ? 'dashboard' : ''));
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width < 801) {
      await page.getByRole('button', { name: 'Open navigation' }).click();
      await expect(page.locator('.mobile-drawer')).toBeVisible();
      await page
        .locator('.mobile-drawer')
        .getByRole('link', { name: 'Visitors', exact: true })
        .click();
      await expect(page.getByRole('heading', { name: 'Visitors', level: 1 })).toBeVisible();
      await expect(page.locator('.mobile-drawer')).not.toBeVisible();
    }
    if (width === 1440)
      await page.screenshot({
        path: 'test-results/' + APP_ROLE + '-dashboard-1440.png',
        fullPage: true,
      });
  });
test('localized error and loading states retain the shell', async ({ page }) => {
  await page.goto(base + 'visitors?state=error');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(
    page.getByText('Information is temporarily unavailable. Please try again.'),
  ).toBeVisible();
  await page.goto(base + 'visitors?state=loading');
  await expect(page.getByTestId('app-shell')).toBeVisible();
  await expect(page.getByRole('status', { name: 'Loading information' })).toBeVisible();
});
test('sign out removes protected pages', async ({ page }) => {
  await page.goto(base + 'visitors');
  await page.locator('.sidebar').getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByTestId('app-shell')).toHaveCount(0);
});
if (APP_ROLE === 'resident') {
  test('cross-tenant URL is rejected', async ({ page }) => {
    await page.goto('/sunridge/complaints');
    await expect(
      page.getByText('This account does not belong to the community in this address.'),
    ).toBeVisible();
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
  });
  test('visitor invitation modal traps focus and closes on Escape', async ({ page }) => {
    await page.goto(base + 'visitors');
    await page.getByRole('button', { name: 'Invite Visitor', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Visitor name').fill('Offline test visitor');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
} else {
  test('authorized community switch keeps the shell mounted', async ({ page }) => {
    await page.goto('/visitors');
    await page.evaluate(() => {
      (window as unknown as { savedShell: Element | null }).savedShell = document.querySelector(
        '[data-testid="app-shell"]',
      );
    });
    await page.getByRole('combobox', { name: 'Selected community' }).selectOption('community-2');
    await expect(page.locator('.page-header')).toContainText('Sunridge');
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { savedShell: Element }).savedShell ===
          document.querySelector('[data-testid="app-shell"]'),
      ),
    ).toBe(true);
  });
}

test('major modules render without mobile overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const modules =
    APP_ROLE === 'admin'
      ? [
          ['residents', 'Residents'],
          ['buildings', 'Buildings'],
          ['units', 'Units'],
          ['billing', 'Bills & Payments'],
          ['notices', 'Notices'],
          ['facilities', 'Facilities'],
          ['reports', 'Reports'],
          ['sos', 'Emergency SOS'],
        ]
      : [
          ['apartment', 'My Apartment'],
          ['bills', 'Bills & Payments'],
          ['facilities', 'Facilities'],
          ['bookings', 'Bookings'],
          ['notices', 'Notices'],
          ['community', 'Community Wall'],
          ['messages', 'Messages'],
          ['documents', 'Documents'],
          ['settings', 'Settings'],
          ['sos', 'Emergency SOS'],
        ];
  for (const [path, title] of modules) {
    await page.goto(base + path);
    await expect(page.getByRole('heading', { name: title, level: 1, exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
if (APP_ROLE === 'admin')
  test('resident onboarding and building forms are available', async ({ page }) => {
    await page.goto('/residents');
    await page.getByRole('button', { name: 'Add Resident', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Resident name')).toBeVisible();
    await expect(page.getByLabel('Resident type')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.goto('/buildings');
    await page.getByRole('button', { name: 'Add Building', exact: true }).click();
    await expect(page.getByLabel('Structure type')).toBeVisible();
    await page.getByLabel('Structure type').selectOption('villa_cluster');
    await expect(page.getByLabel('Total units')).toBeVisible();
  });
