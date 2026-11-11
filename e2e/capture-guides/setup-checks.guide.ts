// Screenshots and clips for the Setup checks guide (apps/studio/src/docs/0.1.8/<locale>/setup-checks.md).
//
// On a fresh install with AUTH_DEV_BYPASS on, the page shows three warnings. The script fixes two
// of them (laboratory name and time zone), runs the checks again, and puts the laboratory back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

let savedLab: Record<string, string> | null = null;

async function restoreLab(api: APIRequestContext): Promise<void> {
  if (!savedLab) return;
  const keys = ['lab.name', 'lab.address', 'lab.contact', 'lab.timezone'];
  const body = Object.fromEntries(keys.map((k) => [k, savedLab?.[k] ?? '']));
  const res = await api.put('/api/settings/lab', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  savedLab = ((await (await request.get('/api/settings/lab')).json()) as { values: Record<string, string> }).values;
});
test.afterAll(async ({ request }) => restoreLab(request));

async function pageMenu(page: Page, item: string): Promise<void> {
  await click(page, page.locator('main').getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first(), 400);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 1200);
}

test('setup checks guide', async ({ page }) => {
  test.setTimeout(200_000);
  await prepareGuidePage(page);

  await open(page, '/studio/settings/setup');
  await expect(page.getByText('3 warnings')).toBeVisible({ timeout: 30_000 });
  await settle(page, 1200);
  await shot(page, 'setup-checks-tour');

  await clip(page, 'setup-checks-fix', async () => {
    await click(page, page.getByRole('link', { name: 'Open Laboratory' }).first(), 1500);
    await type(page, page.getByRole('textbox', { name: 'Laboratory name' }), 'Sample Central Laboratory');
    await type(page, page.getByRole('textbox', { name: 'Time zone' }), 'Africa/Dar_es_Salaam');
    await click(page, page.locator('main').getByRole('button', { name: 'Actions', exact: true }).first(), 400);
    await click(page, page.getByRole('menuitem', { name: 'Save' }), 1200);
    await click(page, page.getByRole('link', { name: 'Setup checks' }), 1500);
    await pageMenu(page, 'Run again');
    await expect(page.getByText('1 warning', { exact: true })).toBeVisible({ timeout: 30_000 });
    await settle(page, 1200);
  });
  await shot(page, 'setup-checks-after');
});
