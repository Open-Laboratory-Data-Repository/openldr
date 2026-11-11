// Screenshots and clips for the SQL Server connections guide (apps/studio/src/docs/0.1.8/<locale>/connector-diagnose.md).
//
// Diagnoses the seeded warehouse connector, then adds a Microsoft SQL connector for a named instance
// whose SQL Server Browser does not answer, diagnoses it, and deletes it again. It never logs in to
// a SQL Server: the made-up instance fails before the login step.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const NAME = 'v1 database (example)';

async function removeConnector(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/connectors')).json()) as Array<{ id: string; name: string }>;
  for (const c of list) if (c.name === NAME) await api.delete(`/api/connectors/${c.id}`);
}

test.beforeAll(async ({ request }) => removeConnector(request));
test.afterAll(async ({ request }) => removeConnector(request));

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function rowAction(page: Page, row: string, item: string): Promise<void> {
  await click(page, page.getByRole('row').filter({ hasText: row }).first().getByRole('button').last(), 400);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 1000);
}

test('connector diagnose guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/settings/connectors');

  // --- Example 1: a connection that works --------------------------------------------------------
  await clip(page, 'connector-diagnose-ok', async () => {
    await rowAction(page, 'Target Warehouse (Postgres)', 'Diagnose');
    await expect(page.getByText('All checks passed.')).toBeVisible({ timeout: 30_000 });
    await settle(page, 1500);
  });
  await shot(page, 'connector-diagnose-passed');
  await page.keyboard.press('Escape');

  // --- Example 2: a named instance that does not answer -------------------------------------------
  await clip(page, 'connector-diagnose-add', async () => {
    await click(page, dots(page, page.locator('main')), 400);
    await click(page, page.getByRole('menuitem', { name: /Add connector/ }), 900);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.locator('#connector-name'), NAME);
    await choose(page, sheet.getByRole('combobox').nth(0), 'Host');
    await choose(page, sheet.getByRole('combobox').nth(1), 'Microsoft SQL');
    await settle(page, 600);
    await type(page, sheet.locator('#connector-db-host'), 'localhost\\SQLEXPRESS');
    await click(page, sheet.locator('#connector-db-database'), 600);
    await type(page, sheet.locator('#connector-db-database'), 'OpenLDRData');
    await type(page, sheet.locator('#connector-db-user'), 'v1_reader');
    await type(page, sheet.locator('#connector-db-password'), 'example-only');
    await settle(page, 600);
  });
  await shot(page, 'connector-diagnose-form');
  const sheet = page.getByRole('dialog').first();
  console.log('HOST', await sheet.locator('#connector-db-host').inputValue(), 'INSTANCE', await sheet.locator('#connector-db-instanceName').inputValue());
  await click(page, dots(page, sheet), 350);
  await click(page, page.getByRole('menuitem', { name: 'Save', exact: true }), 1500);
  await expect(page.getByRole('row').filter({ hasText: NAME })).toBeVisible();

  await clip(page, 'connector-diagnose-browser', async () => {
    await rowAction(page, NAME, 'Diagnose');
    await page.waitForTimeout(8000);
    await settle(page, 1500);
  });
  console.log('DIAG', await page.getByRole('dialog').first().innerText());
  await shot(page, 'connector-diagnose-failed');
});
