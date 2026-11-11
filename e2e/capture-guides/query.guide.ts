// Screenshots and clips for the Custom Queries guide (apps/studio/src/docs/0.1.8/<locale>/query.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// Afterwards it deletes the query it saved.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const SAVED = 'Orders by priority for one test';

async function removeSaved(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/custom-queries')).json()) as Array<{ id: string; name: string }>;
  for (const q of list) if (q.name === SAVED) await api.delete(`/api/custom-queries/${q.id}`);
}

test.beforeAll(async ({ request }) => removeSaved(request));
test.afterAll(async ({ request }) => removeSaved(request));

const workspace = (page: Page) => page.getByTestId('query-workspace');

async function escape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.getByRole('menu').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}

/** Replace the text in the open tab's SQL editor. */
async function writeSql(page: Page, sql: string): Promise<void> {
  const code = workspace(page).locator('.cm-content').first();
  await click(page, code, 150);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(sql);
  await page.waitForTimeout(400);
}

test('query guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/query');

  // --- Example 1: browse a table ---------------------------------------------------------------
  await clip(page, 'query-browse', async () => {
    await click(page, page.getByRole('button', { name: 'Connectors', exact: true }));
    await click(page, page.getByRole('button', { name: /Target Warehouse/ }).first(), 800);
    await click(page, page.getByRole('button', { name: 'public', exact: true }), 800);
    await click(page, page.getByRole('button', { name: 'lab_requests', exact: true }), 1500);
    await expect(page.getByText('1–50 of 60')).toBeVisible();
  });
  await shot(page, 'query-tour', {
    callouts: [
      { number: 1, selector: 'button:has-text("Connectors")', offsetX: -30, offsetY: -12 },
      { number: 2, selector: 'button:has-text("Datasets")', offsetX: -40, offsetY: -12 },
      { number: 3, selector: 'button:has-text("Custom Queries")', offsetX: -20, offsetY: -12 },
      { number: 4, selector: 'button[aria-label="new query"]', offsetX: -6, offsetY: -14 },
      { number: 5, selector: '[data-testid="query-workspace"] button[aria-label="Run"]', offsetX: -44, offsetY: 24 },
    ],
  });

  // --- Example 2: write a query ----------------------------------------------------------------
  await clip(page, 'query-write', async () => {
    await click(page, page.getByRole('button', { name: 'new query' }), 800);
    await choose(page, workspace(page).getByRole('combobox', { name: 'Connector' }), 'Target Warehouse (Postgres)');
    await writeSql(page, [
      'SELECT panel_desc AS test, COUNT(*) AS orders',
      'FROM lab_requests',
      'GROUP BY panel_desc',
      'ORDER BY orders DESC',
    ].join('\n'));
    await click(page, workspace(page).getByRole('button', { name: 'Run', exact: true }), 1500);
    await expect(workspace(page).getByText('Full blood count').first()).toBeAttached();
  });

  // --- Example 3: a parameter ------------------------------------------------------------------
  await clip(page, 'query-params', async () => {
    await writeSql(page, [
      'SELECT priority, COUNT(*) AS orders',
      'FROM lab_requests',
      'WHERE panel_desc = {{ param.test }}',
      'GROUP BY priority',
      'ORDER BY orders DESC',
    ].join('\n'));
    await click(page, workspace(page).getByRole('button', { name: 'Parameters' }), 700);
    const sheet = page.getByRole('dialog').first();
    await click(page, sheet.getByRole('button', { name: 'Add', exact: true }), 500);
    const id = sheet.getByRole('textbox', { name: 'param-0-id' });
    await click(page, id, 100);
    await id.fill('test');
    await type(page, sheet.getByRole('textbox', { name: 'param-0-label' }), 'Test');
    await choose(page, sheet.getByRole('combobox', { name: 'param-0-type' }), 'select');
    const options = sheet.getByRole('textbox', { name: /options/i }).first();
    await type(page, options, 'SELECT DISTINCT panel_desc FROM lab_requests ORDER BY 1');
    await click(page, sheet.getByRole('checkbox', { name: 'param-0-required' }), 300);
    await click(page, sheet.getByRole('button', { name: 'Save', exact: true }), 700);
  });
  // The parameter sheet, open, for a still.
  await click(page, workspace(page).getByRole('button', { name: 'Parameters' }), 700);
  await shot(page, 'query-params-sheet', { crop: page.getByRole('dialog').first(), pad: 0 });
  await click(page, page.getByRole('dialog').first().getByRole('button', { name: 'Cancel', exact: true }), 500);

  await clip(page, 'query-run-values', async () => {
    await click(page, workspace(page).getByRole('button', { name: 'Run', exact: true }), 800);
    const sheet = page.getByRole('dialog').first();
    await choose(page, sheet.getByRole('combobox').first(), 'HIV viral load');
    await click(page, sheet.getByRole('button', { name: /actions/i }).first());
    await click(page, page.getByRole('menuitem', { name: /Run with these values/i }), 1500);
    await expect(workspace(page).getByText('urgent').first()).toBeAttached();
  });

  // --- Example 4: save it ----------------------------------------------------------------------
  await clip(page, 'query-save', async () => {
    await click(page, workspace(page).getByRole('button', { name: 'Query actions', exact: true }));
    await click(page, page.getByRole('menuitem', { name: 'Save', exact: true }), 600);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.getByRole('textbox').first(), SAVED);
    await click(page, sheet.getByRole('button', { name: /actions/i }).first());
    await click(page, page.getByRole('menuitem', { name: 'Save', exact: true }), 900);
    if ((await page.getByTestId('query-explorer').getByRole('button', { name: SAVED, exact: true }).count()) === 0) await click(page, page.getByRole('button', { name: 'Custom Queries', exact: true }), 700);
    await expect(page.getByTestId('query-explorer').getByRole('button', { name: SAVED, exact: true })).toBeVisible();
  });

  // The saved query's own actions menu.
  await click(page, page.getByRole('button', { name: `Actions for “${SAVED}”` }), 500);
  await shot(page, 'query-row-actions', { crop: page.getByRole('menu').first(), pad: 6 });
  await escape(page);

  // The Explorer's own menu: refresh, export, import.
  await click(page, page.getByRole('button', { name: 'Transfer actions' }), 400);
  await shot(page, 'query-transfer-menu', { crop: page.getByRole('menu').first(), pad: 6 });
  await escape(page);

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio/query');
  // On a phone the Explorer starts folded. Open it, as the guide tells readers to.
  await click(page, page.getByRole('button', { name: /Expand explorer/i }).first(), 600);
  await click(page, page.getByRole('button', { name: 'Custom Queries', exact: true }), 600);
  await shot(page, 'query-phone');
});
