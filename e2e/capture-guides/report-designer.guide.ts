// Screenshots and clips for the Report Designer guide (apps/studio/src/docs/0.1.8/<locale>/report-designer.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// Example 2 makes a template and a library report called "Patients by age band (sample)", and
// the script deletes both again.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const NAME = 'Patients by age band (sample)';

async function removeBuilt(api: APIRequestContext): Promise<void> {
  const defs = (await (await api.get('/api/report-defs')).json()) as Array<{ id: string; name: string }> | { rows: Array<{ id: string; name: string }> };
  for (const d of Array.isArray(defs) ? defs : defs.rows) if (d.name === NAME) await api.delete(`/api/report-defs/${d.id}`);
  const designs = (await (await api.get('/api/report-designs')).json()) as Array<{ id: string; name: string }>;
  for (const d of designs) if (d.name === NAME) await api.delete(`/api/report-designs/${d.id}`);
}

test.beforeAll(async ({ request }) => removeBuilt(request));
test.afterAll(async ({ request }) => removeBuilt(request));

async function more(page: Page, ...items: string[]): Promise<void> {
  await click(page, page.getByRole('button', { name: 'More actions' }), 350);
  for (const item of items) await click(page, page.getByRole('menuitem', { name: item, exact: true }), 700);
}

const panelTab = (page: Page, name: string) => page.getByText(name, { exact: true }).last();

test('report designer guide', async ({ page }) => {
  test.setTimeout(400_000);
  await prepareGuidePage(page);
  await open(page, '/studio/report-designer');

  // --- Example 1: read how a built-in report is made --------------------------------------------
  await clip(page, 'report-designer-explore', async () => {
    await click(page, page.getByText('Test Volume Over Time', { exact: true }).first(), 2000);
    await click(page, page.getByRole('button', { name: /^Data/ }).filter({ hasText: 'Month' }).first(), 600);
    await click(page, panelTab(page, 'Data'), 900);
    await settle(page, 1000);
  });
  await shot(page, 'report-designer-tour');

  // --- Example 2: build a design ----------------------------------------------------------------
  await clip(page, 'report-designer-build', async () => {
    await more(page, 'New template');
    await settle(page, 1200);
    const title = page.getByRole('textbox', { name: 'Report name' });
    await type(page, title, NAME);
    await more(page, 'Insert', 'Table');
    await settle(page, 800);
    await click(page, panelTab(page, 'Data'), 700);
    await choose(page, page.getByRole('combobox').first(), 'Patient demographics by age band');
    await click(page, page.getByRole('button', { name: 'Load columns' }), 2500);
    // Tick each column by the box holding its name. Ticking turns that box into a label field,
    // so each one is found fresh just before it is ticked.
    for (const column of ['band', 'total', 'male', 'female', 'other']) {
      const row = page.locator('div').filter({ has: page.locator(`input[value="${column}"]`) }).last();
      await click(page, row.getByRole('checkbox').first(), 300);
    }
    await click(page, page.getByRole('button', { name: 'Load pages' }), 2500);
    await click(page, page.getByRole('button', { name: 'Show data' }), 1500);
    await settle(page, 1000);
  });
  await shot(page, 'report-designer-bound');

  // --- Example 2, continued: save, publish, make a library report -------------------------------
  await clip(page, 'report-designer-publish', async () => {
    await more(page, 'Save');
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    await more(page, 'Publish revision');
    await settle(page, 1500);
    await more(page, 'Create report from this design');
    await settle(page, 1000);
  });
  const sheet = page.getByRole('dialog').first();
  await clip(page, 'report-designer-create-report', async () => {
    await type(page, sheet.getByRole('textbox').first(), NAME);
    await click(page, sheet.getByRole('button', { name: /AMR \/ Surveillance/ }), 500);
    await click(page, page.getByRole('button', { name: 'Select category Operational' }), 500);
    await click(page, sheet.getByRole('button', { name: 'Actions' }), 350);
    await click(page, page.getByRole('menuitem', { name: 'Create report' }), 2000);
    await settle(page, 1000);
  });

  // --- Example 2, last step: run it from Reports ------------------------------------------------
  await open(page, '/studio/reports');
  await clip(page, 'report-designer-run', async () => {
    await click(page, page.getByText(NAME, { exact: true }).first(), 800);
    await click(page, page.locator('main').getByRole('button', { name: 'Actions' }).first(), 300);
    await click(page, page.getByRole('menuitem', { name: 'Parameters', exact: true }), 700);
    await click(page, page.getByRole('dialog').first().getByRole('button', { name: 'Run' }), 3000);
    await settle(page, 1200);
  });
  await shot(page, 'report-designer-report', { crop: page.locator('canvas').first(), pad: 0 });
});
