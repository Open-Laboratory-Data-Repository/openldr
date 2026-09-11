import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { addCallouts, disableAnimations, preparePage, removeCallouts } from '../capture-docs/capture-helpers';
import { loadCaptureManifest } from '../capture-docs/manifest';

// No global setup, database, or backend. Every API request terminates in this browser context.
test('capture current Start Here navigation and parameters with synthetic data', async ({ page }) => {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') { writes.push(req.method() + ' ' + req.url()); return route.abort(); }
    const path = new URL(req.url()).pathname;
    const payload = path === '/api/config' ? { authEnforced: false, dashboardSqlEnabled: false }
      : path === '/api/me' ? { id: 'docs', username: 'Documentation example', roles: ['lab_admin'] }
      : path === '/api/me/capabilities' ? { capabilities: ['dashboards.view', 'reports.view', 'reports.edit_templates', 'query.run', 'workflows.view', 'facilities.view', 'users.view', 'activity.view'] }
      : path === '/api/reports' ? [{ id: 'docs-example', name: 'Example report', description: 'Synthetic report for navigation only', category: 'General', parameters: [{ id: 'period', label: 'Period', type: 'text', required: true, placeholder: 'Example period' }] }]
      : path.includes('/options') ? {}
      : path === '/api/dashboards' ? [{ id: 'docs', name: 'Documentation example', widgets: [], layouts: {}, filters: [] }]
      : path.includes('notifications') ? { items: [], unreadCount: 0 }
      : [];
    await route.fulfill({ json: payload });
  });
  await preparePage(page, 'dark');
  const manifest = await loadCaptureManifest();
  const capture = async (name: string, selector: string) => {
    const shot = manifest.shots.find((item) => item.name === name)!;
    await disableAnimations(page);
    await addCallouts(page, shot.callouts);
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    await page.screenshot({ clip: { ...box!, height: Math.min(box!.height, selector === '[role="dialog"]' ? 240 : box!.height) }, path: fileURLToPath(new URL('../../apps/studio/src/docs/0.1.0/screenshots/' + name, import.meta.url)) });
    await removeCallouts(page);
  };
  await page.goto('/studio/');
  await expect(page.locator('nav a[href="/studio/facilities"]')).toBeVisible();
  await capture('start-here-navigation.png', 'nav');
  await page.goto('/studio/reports');
  await page.getByText('Example report', { exact: true }).click();
  await page.getByRole('button', { name: 'Actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Parameters', exact: true })).toBeVisible();
  await capture('start-here-report-menu.png', '[role="menu"]');
  await page.getByRole('menuitem', { name: 'Parameters', exact: true }).click();
  await page.getByPlaceholder('Example period').fill('Example');
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
  await capture('start-here-parameters.png', '[role="dialog"]');
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByPlaceholder('Example period')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeInViewport();
  expect(writes).toEqual([]);
});
