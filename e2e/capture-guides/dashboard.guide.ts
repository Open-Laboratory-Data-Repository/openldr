// Screenshots and clips for the Dashboards guide (apps/studio/src/docs/0.1.8/<locale>/dashboard.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// It follows the guide's examples in order. Afterwards it puts the sample dashboard and the
// raw SQL setting back as it found them, and deletes the dashboard it built.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { choose, click, clip, open, point, prepareGuidePage, settle, shot, type, VIEWPORT } from './kit';

const RAW_SQL = 'dashboard.raw_sql';
let originalSample: unknown = null;
let originalRawSql: boolean | null = null;

async function removeGuideDashboards(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/dashboards')).json()) as Array<{ id: string; name: string }>;
  for (const d of list) {
    if (d.id !== 'default' && /^New dashboard( \(\d+\))?$/.test(d.name)) await api.delete(`/api/dashboards/${d.id}`);
  }
}

async function setRawSql(api: APIRequestContext, value: boolean): Promise<void> {
  const res = await api.put(`/api/settings/flags/${RAW_SQL}`, { data: { value } });
  expect(res.ok(), `set ${RAW_SQL}`).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/dashboards/default');
  expect(res.ok(), 'the sample dashboard (id "default") must exist').toBeTruthy();
  originalSample = await res.json();
  const flags = (await (await request.get('/api/settings/flags')).json()) as Array<{ id: string; value: boolean }>;
  originalRawSql = flags.find((f) => f.id === RAW_SQL)?.value ?? false;
  await setRawSql(request, false);
  await removeGuideDashboards(request);
});

test.afterAll(async ({ request }) => {
  if (originalSample) await request.put('/api/dashboards/default', { data: originalSample });
  if (originalRawSql !== null) await setRawSql(request, originalRawSql);
  await removeGuideDashboards(request);
});

const editor = (page: Page) => page.getByRole('dialog').first();

async function dashboardMenu(page: Page, item: string): Promise<void> {
  await click(page, page.getByRole('button', { name: 'Dashboard menu' }));
  await click(page, page.getByRole('menuitem', { name: item, exact: true }));
}

async function editorMenu(page: Page, item: string): Promise<void> {
  await click(page, editor(page).getByRole('button', { name: 'Editor menu' }));
  await click(page, page.getByRole('menuitem', { name: item, exact: true }));
}

async function pickChart(page: Page, label: string): Promise<void> {
  await editorMenu(page, 'Charts');
  await click(page, page.getByRole('button', { name: label, exact: true }), 600);
}

async function saveWidget(page: Page, title?: string): Promise<void> {
  await editorMenu(page, 'Save');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settle(page, 900);
  // A new widget lands at the bottom of the grid. Bring it into view so the reader sees it.
  if (title) {
    await page.locator('.react-grid-item').filter({ hasText: title }).first().scrollIntoViewIfNeeded();
    await settle(page, 500);
  }
}

/** Drag a widget by its title to a point on the grid (edit mode only). */
async function drag(page: Page, title: string, to: { x: number; y: number }): Promise<void> {
  const grip = page.locator('.react-grid-item').filter({ hasText: title }).first().locator('span.font-medium').first();
  await point(page, grip);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 });
  await page.mouse.up();
  await settle(page, 700);
}

async function widgetMenu(page: Page, title: string, item: string): Promise<void> {
  const card = page.locator('.react-grid-item').filter({ hasText: title }).first();
  await click(page, card.getByRole('button', { name: 'Widget menu' }));
  await click(page, page.getByRole('menuitem', { name: item }));
}

/** Choose October 2026 in the dashboard's Period filter. */
async function pickOctober(page: Page): Promise<void> {
  await click(page, page.getByRole('button', { name: /Pick a date range|2026/ }).first(), 500);
  const previous = page.getByRole('button', { name: /previous month/i }).first();
  for (let i = 0; i < 12 && !(await page.getByRole('button', { name: /October 1st, 2026/ }).first().isVisible()); i++) {
    await click(page, previous, 200);
  }
  await click(page, page.getByRole('button', { name: /October 1st, 2026/ }).first(), 300);
  await click(page, page.getByRole('button', { name: /October 31st, 2026/ }).first(), 500);
  await page.keyboard.press('Escape');
  await settle(page, 900);
}

test('dashboard guide', async ({ page, request }) => {
  test.setTimeout(420_000);
  await prepareGuidePage(page);
  await open(page, '/studio');
  // The numbers in the guide assume the sample data, and nothing else, is loaded.
  await expect(page.getByText('60', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // --- Tour of the sample dashboard ------------------------------------------------------------
  await shot(page, 'dashboard-tour', {
    callouts: [
      { number: 1, selector: 'button[aria-label="Dashboard"]', offsetX: -8, offsetY: -14 },
      { number: 2, selector: 'button[aria-label="Refresh"]', offsetX: -52, offsetY: 2 },
      { number: 3, selector: 'button[aria-label="Dashboard menu"]', offsetX: -14, offsetY: 30 },
      { number: 4, selector: 'button:has-text("Pick a date range")', offsetX: -96, offsetY: 38 },
      { number: 5, selector: '.react-grid-item:has-text("Total Orders")', offsetX: -36, offsetY: 6 },
    ],
  });

  // --- Example: filter the sample dashboard ----------------------------------------------------
  await clip(page, 'dashboard-filters', async () => {
    await pickOctober(page);
    await choose(page, page.getByRole('combobox', { name: 'Test' }), 'HIV viral load');
    await settle(page, 900);
    await choose(page, page.getByRole('combobox', { name: 'Priority' }), 'urgent');
    await settle(page, 1200);
  });
  await shot(page, 'dashboard-filters-result', { crop: page.locator('.dash-grid').first(), pad: 0 });
  await open(page, '/studio');

  // --- Example: a new dashboard and a bar chart made with the Builder --------------------------
  await clip(page, 'dashboard-new-widget', async () => {
    await dashboardMenu(page, 'New dashboard');
    await settle(page, 600);
    await dashboardMenu(page, 'Add widget');
    await type(page, editor(page).getByRole('textbox', { name: 'Title' }), 'Orders by test');
    await click(page, editor(page).getByRole('button', { name: 'Group by' }).last());
    await choose(page, editor(page).getByRole('combobox', { name: 'Group by' }), 'Test');
    await settle(page, 600);
    await pickChart(page, 'Bar');
    await saveWidget(page, 'Orders by test');
  });

  // The editor, labelled, opened again from the widget's own menu.
  await widgetMenu(page, 'Orders by test', 'Edit');
  await settle(page, 900);
  await shot(page, 'dashboard-builder', {
    callouts: [
      { number: 1, selector: '[role="dialog"] input[aria-label="Title"]', offsetX: 6, offsetY: -12 },
      { number: 2, selector: '[role="dialog"] button[aria-label="Data"]', offsetX: -40, offsetY: -12 },
      { number: 3, selector: '[role="dialog"] button[aria-label="Remove summarize"]', offsetX: -60, offsetY: -12 },
      { number: 4, selector: '[role="dialog"] button[aria-label="Remove group by"]', offsetX: -60, offsetY: -12 },
      { number: 5, selector: '[role="dialog"] button[aria-pressed]:has-text("Builder")', offsetX: 52, offsetY: -12 },
      { number: 6, selector: '[role="dialog"] button[aria-label="Editor menu"]', offsetX: 4, offsetY: 0 },
    ],
  });
  await editorMenu(page, 'Charts');
  await shot(page, 'dashboard-chart-types', { crop: page.getByRole('dialog').last(), pad: 0 });
  await page.keyboard.press('Escape');
  await click(page, editor(page).getByRole('button', { name: 'Close' }).first());
  await settle(page);

  // --- Example: orders per week -----------------------------------------
  await clip(page, 'dashboard-trend', async () => {
    await dashboardMenu(page, 'Add widget');
    await type(page, editor(page).getByRole('textbox', { name: 'Title' }), 'Orders per week');
    await click(page, editor(page).getByRole('button', { name: 'Group by' }).last());
    await choose(page, editor(page).getByRole('combobox', { name: 'Group by' }), 'Authored');
    await choose(page, editor(page).getByRole('combobox', { name: 'Grain' }), 'week');
    await settle(page, 600);
    await pickChart(page, 'Line');
    await saveWidget(page, 'Orders per week');
  });

  // --- Example: one number with a condition ----------------------------------------------------
  await clip(page, 'dashboard-number', async () => {
    await dashboardMenu(page, 'Add widget');
    await type(page, editor(page).getByRole('textbox', { name: 'Title' }), 'High results');
    await choose(page, editor(page).getByRole('combobox', { name: 'Data' }), 'Results');
    await click(page, editor(page).getByRole('button', { name: 'Filter' }).last());
    await click(page, editor(page).getByRole('button', { name: 'Add condition' }));
    await choose(page, editor(page).getByRole('combobox', { name: 'Filter field' }), 'Interpretation');
    await type(page, editor(page).getByRole('textbox', { name: 'Filter value' }), 'H');
    await settle(page, 900);
    await saveWidget(page, 'High results');
  });

  // --- Move and resize -------------------------------------------------------------------------
  await clip(page, 'dashboard-layout', async () => {
    const target = await page.locator('.react-grid-item').filter({ hasText: 'Orders by test' }).first().boundingBox();
    if (!target) throw new Error('no box for Orders by test');
    // The number goes to the empty space right of the bar chart.
    await drag(page, 'High results', { x: target.x + target.width + 60, y: target.y + 12 });
    const trend = page.locator('.react-grid-item').filter({ hasText: 'Orders per week' }).first();
    await trend.scrollIntoViewIfNeeded();
    const handle = trend.locator('.react-resizable-handle').first();
    const box = await handle.boundingBox();
    if (!box) throw new Error('no resize handle');
    await point(page, handle);
    await page.mouse.down();
    await page.mouse.move(Math.min(VIEWPORT.width - 30, box.x + 420), box.y, { steps: 30 });
    await page.mouse.up();
    await settle(page, 900);
  });

  // --- Dashboard filters -----------------------------------------------------------------------
  await clip(page, 'dashboard-filter-add', async () => {
    await dashboardMenu(page, 'Edit filters');
    const sheet = page.getByRole('dialog').first();
    await click(page, sheet.getByRole('button', { name: 'Filter actions' }));
    await click(page, page.getByRole('menuitem', { name: 'Add filter' }));
    // Paste, don't type: this box loses focus after each letter (DashboardFilterEditor keys
    // its rows by the id being edited). The guide tells readers the same.
    const id = sheet.getByRole('textbox', { name: 'filter-0-id' });
    await click(page, id, 100);
    await id.fill('period');
    await page.waitForTimeout(300);
    await type(page, sheet.getByRole('textbox', { name: 'filter-0-label' }), 'Period');
    await choose(page, sheet.getByRole('combobox', { name: 'filter-0-type' }), 'Date range');
    await settle(page, 500);
  });
  await shot(page, 'dashboard-filter-editor', { crop: page.getByRole('dialog').first(), pad: 0 });
  await click(page, page.getByRole('dialog').first().getByRole('button', { name: 'Filter actions' }));
  await click(page, page.getByRole('menuitem', { name: 'Save' }));
  await settle(page, 700);
  // Done saves the layout and the new filter before we leave the page.
  await dashboardMenu(page, 'Done');
  await settle(page, 700);

  // --- A widget written in SQL -----------------------------------------------------------------
  await open(page, '/studio/settings');
  const rawSqlRow = page.getByRole('switch', { name: 'Dashboard raw SQL' });
  await rawSqlRow.scrollIntoViewIfNeeded();
  await shot(page, 'dashboard-raw-sql-setting', {
    crop: rawSqlRow.locator('xpath=ancestor::*[self::div or self::li][2]'),
    pad: 8,
  });
  await setRawSql(request, true);
  await open(page, '/studio');
  await choose(page, page.getByRole('combobox', { name: 'Dashboard' }), 'New dashboard');
  await dashboardMenu(page, 'Edit');
  await clip(page, 'dashboard-sql', async () => {
    await dashboardMenu(page, 'Add widget');
    await type(page, editor(page).getByRole('textbox', { name: 'Title' }), 'Orders by requesting site');
    await click(page, editor(page).getByRole('button', { name: 'SQL', exact: true }), 600);
    const code = editor(page).locator('.cm-content').first();
    await click(page, code, 200);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(
      [
        'SELECT requester_display AS label, COUNT(*) AS value',
        'FROM lab_requests',
        'WHERE 1=1',
        '[[AND substring(authored_at,1,10) >= {{period_from}}]]',
        '[[AND substring(authored_at,1,10) <= {{period_to}}]]',
        'GROUP BY requester_display',
        'ORDER BY value DESC',
      ].join('\n'),
    );
    await settle(page, 400);
    await click(page, editor(page).getByRole('button', { name: 'Run query' }), 900);
    await pickChart(page, 'Row');
    await settle(page, 600);
  });
  // Tie the SQL's {{period_from}} and {{period_to}} to the dashboard's Period filter.
  await clip(page, 'dashboard-sql-variables', async () => {
    await editorMenu(page, 'Filters');
    const sheet = page.getByRole('dialog').last();
    await choose(page, sheet.getByRole('combobox', { name: 'Type' }).first(), 'Date Range');
    await choose(page, sheet.getByRole('combobox', { name: 'Dashboard filter' }).first(), 'Period (period)');
    await settle(page, 500);
  });
  await page.keyboard.press('Escape');
  await settle(page, 300);
  await saveWidget(page, 'Orders by requesting site');
  await dashboardMenu(page, 'Done');
  await settle(page, 900);
  await clip(page, 'dashboard-filter-apply', async () => {
    await pickOctober(page);
    // Scroll down to the SQL widget, the one the Period filter changes.
    await page.locator('.react-grid-item').filter({ hasText: 'Orders by requesting site' }).first()
      .evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await settle(page, 1200);
  });

  // --- Menus and the delete prompt -------------------------------------------------------------
  await dashboardMenu(page, 'Edit');
  await click(page, page.getByRole('button', { name: 'Dashboard menu' }));
  await shot(page, 'dashboard-menu-edit', { crop: page.getByRole('menu').first(), pad: 6 });
  await click(page, page.getByRole('menuitem', { name: 'Delete' }));
  await shot(page, 'dashboard-delete-confirm', { crop: page.getByRole('alertdialog').first(), pad: 0 });
  await page.keyboard.press('Escape');
  await dashboardMenu(page, 'Done');

  // --- On a phone ------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio');
  await shot(page, 'dashboard-phone');
  await page.setViewportSize(VIEWPORT);
});
