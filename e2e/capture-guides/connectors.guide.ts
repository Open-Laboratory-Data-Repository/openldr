// Screenshots and clips for the Connectors guide (apps/studio/src/docs/0.1.8/<locale>/connectors.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file), and
// TARGET_DATABASE_URL set to the warehouse database as the capture machine reaches it, for example
// postgres://openldr:openldr@localhost:5433/openldr_target. The script uses it to make a read-only
// database account, `docs_report_reader`, that the examples connect with. Afterwards it removes the
// connector it added and drops that account.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import pg from 'pg';

import { choose, click, clip, open, point, prepareGuidePage, settle, shot, type } from './kit';

const NAME = 'Warehouse (read only)';
const ROLE = 'docs_report_reader';
const FIRST_PASSWORD = 'docs-reader-1';
const SECOND_PASSWORD = 'docs-reader-2';
const READABLE = ['lab_requests', 'lab_results', 'specimens', 'diagnostic_reports', 'facilities'];

const target = new URL(process.env.TARGET_DATABASE_URL ?? 'postgres://openldr:openldr@localhost:5433/openldr_target');
const database = target.pathname.replace(/^\//, '');

async function sql(text: string): Promise<void> {
  const client = new pg.Client({ connectionString: target.toString() });
  await client.connect();
  try { await client.query(text); } finally { await client.end(); }
}

async function dropRole(): Promise<void> {
  await sql(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
      EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE}';
      EXECUTE 'REVOKE ALL ON SCHEMA public FROM ${ROLE}';
      EXECUTE 'REVOKE ALL ON DATABASE "${database}" FROM ${ROLE}';
      EXECUTE 'DROP ROLE ${ROLE}';
    END IF; END $$;`);
}

async function removeConnector(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/connectors')).json()) as Array<{ id: string; name: string }>;
  for (const c of list) if (c.name === NAME) await api.delete(`/api/connectors/${c.id}`);
}

test.beforeAll(async ({ request }) => {
  await removeConnector(request);
  await dropRole();
  await sql(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${FIRST_PASSWORD}'`);
  await sql(`GRANT CONNECT ON DATABASE "${database}" TO ${ROLE}`);
  await sql(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  await sql(`GRANT SELECT ON ${READABLE.join(', ')} TO ${ROLE}`);
});
test.afterAll(async ({ request }) => {
  await removeConnector(request);
  await dropRole();
});

/** The dots-menu button inside `scope`. The icon locator must come from the page: a `has` filter is
 *  matched inside each candidate button, so a scoped locator would never match. */
const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function rowAction(page: Page, row: string, item: string): Promise<void> {
  await click(page, page.getByRole('row', { name: new RegExp(row.replace(/[()]/g, '\\$&')) }).getByRole('button').last(), 400);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 600);
}

async function sheetSave(page: Page): Promise<void> {
  const sheet = page.getByRole('dialog').first();
  await click(page, dots(page, sheet), 400);
  await click(page, page.getByRole('menuitem', { name: 'Save', exact: true }), 1200);
}

const workspace = (page: Page) => page.getByTestId('query-workspace');

async function writeSql(page: Page, text: string): Promise<void> {
  await click(page, workspace(page).locator('.cm-content').first(), 150);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(400);
}

test('connectors guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/settings/connectors');
  await shot(page, 'connectors-tour');

  // --- Example 1: test the warehouse connector --------------------------------------------------
  await clip(page, 'connectors-test', async () => {
    await rowAction(page, 'Target Warehouse (Postgres)', 'Test');
    await expect(page.getByText('Connection OK').first()).toBeVisible({ timeout: 15_000 });
    await settle(page, 1200);
  });

  // --- Example 2: add a read-only connector -----------------------------------------------------
  await clip(page, 'connectors-add', async () => {
    await click(page, dots(page, page.locator('main')), 400);
    await click(page, page.getByRole('menuitem', { name: /Add connector/ }), 800);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.locator('#connector-name'), NAME);
    await choose(page, sheet.getByRole('combobox').nth(0), 'Host');
    await choose(page, sheet.getByRole('combobox').nth(1), 'Postgres');
    await type(page, sheet.locator('#connector-db-host'), target.hostname);
    await type(page, sheet.locator('#connector-db-port'), target.port || '5432');
    await type(page, sheet.locator('#connector-db-database'), database);
    await type(page, sheet.locator('#connector-db-user'), ROLE);
    await type(page, sheet.locator('#connector-db-password'), FIRST_PASSWORD);
    await sheetSave(page);
    await expect(page.getByRole('row', { name: /Warehouse \(read only\)/ })).toBeVisible();
    await rowAction(page, NAME, 'Test');
    await expect(page.getByText('Connection OK').first()).toBeVisible({ timeout: 15_000 });
    await settle(page, 1200);
  });

  // --- Example 2, continued: what the account can and cannot read -------------------------------
  await open(page, '/studio/query');
  if (await page.getByRole('button', { name: /Expand explorer/i }).count()) {
    await click(page, page.getByRole('button', { name: /Expand explorer/i }).first(), 600);
  }
  await clip(page, 'connectors-readonly-query', async () => {
    await click(page, page.getByRole('button', { name: 'new query' }), 800);
    await choose(page, workspace(page).getByRole('combobox', { name: 'Connector' }), NAME);
    await writeSql(page, 'SELECT COUNT(*) AS orders FROM lab_requests');
    await click(page, workspace(page).getByRole('button', { name: 'Run', exact: true }), 1500);
    await expect(workspace(page).getByText('60').first()).toBeAttached();
    await settle(page, 800);
    await writeSql(page, 'SELECT COUNT(*) AS patients FROM patients');
    await click(page, workspace(page).getByRole('button', { name: 'Run', exact: true }), 1500);
    await expect(page.getByText(/permission denied/i).first()).toBeAttached();
    // The error shows only in the run-status mark's tooltip, so point at it.
    await point(page, workspace(page).getByRole('status', { name: 'run status' }));
    await settle(page, 1500);
  });
  await shot(page, 'connectors-readonly-denied', { hover: workspace(page).getByRole('status', { name: 'run status' }) });

  // --- Example 3: rotate the password -----------------------------------------------------------
  await sql(`ALTER ROLE ${ROLE} PASSWORD '${SECOND_PASSWORD}'`);
  await open(page, '/studio/settings/connectors');
  await rowAction(page, NAME, 'Test');
  await settle(page, 2500);
  await shot(page, 'connectors-test-failed');
  await clip(page, 'connectors-rotate', async () => {
    await rowAction(page, NAME, 'Edit');
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.locator('#connector-db-password'), SECOND_PASSWORD);
    await sheetSave(page);
    await rowAction(page, NAME, 'Test');
    await expect(page.getByText('Connection OK').first()).toBeVisible({ timeout: 15_000 });
    await settle(page, 1200);
  });
});
