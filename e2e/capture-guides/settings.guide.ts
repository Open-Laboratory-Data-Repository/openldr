// Screenshots and clips for the Laboratory and Data exposure guides
// (apps/studio/src/docs/0.1.8/<locale>/laboratory.md, data-exposure.md). Settings itself stays a
// short routing page with no pictures, so this script takes none of it.
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// It changes the laboratory identity and one data-exposure column, then puts both back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

let savedLab: Record<string, string> | null = null;

async function restoreLab(api: APIRequestContext): Promise<void> {
  if (!savedLab) return;
  const keys = ['lab.name', 'lab.address', 'lab.contact', 'lab.timezone'];
  const body = Object.fromEntries(keys.map((k) => [k, savedLab?.[k] ?? '']));
  const res = await api.put('/api/settings/lab', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/settings/lab');
  savedLab = ((await res.json()) as { values: Record<string, string> }).values;
});
test.afterAll(async ({ request }) => restoreLab(request));

/** Open a settings page's dots menu, named after the page or "Actions", and pick an item. */
async function pageActions(page: Page, menu: string, item: string): Promise<void> {
  await click(page, page.locator('main').getByRole('button', { name: menu, exact: true }).first(), 400);
  await click(page, page.getByRole('menuitem', { name: item }), 1000);
}

test('settings guides', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);

  // --- Laboratory: change the letterhead and see it on a report ---------------------------------
  await open(page, '/studio/settings/laboratory');
  await clip(page, 'laboratory-identity', async () => {
    await type(page, page.getByRole('textbox', { name: 'Laboratory name' }), 'Sample Central Laboratory');
    await type(page, page.getByRole('textbox', { name: 'Address' }), '1 Sample Road, Sample City');
    await type(page, page.getByRole('textbox', { name: 'Contact' }), 'lab@example.org');
    await type(page, page.getByRole('textbox', { name: 'Time zone' }), 'Africa/Dar_es_Salaam');
    await pageActions(page, 'Actions', 'Save');
    await settle(page, 800);
  });
  await open(page, '/studio/reports');
  await click(page, page.getByText('Test Volume Over Time', { exact: true }).first(), 600);
  await click(page, page.locator('main').getByRole('button', { name: 'Actions' }).first(), 300);
  await click(page, page.getByRole('menuitem', { name: 'Parameters', exact: true }), 600);
  const sheet = page.getByRole('dialog').first();
  await click(page, sheet.getByRole('button', { name: /Date range|2026/ }).first(), 400);
  const previous = page.getByRole('button', { name: /previous month/i }).first();
  for (let i = 0; i < 12 && !(await page.getByRole('button', { name: /September 1st, 2026/ }).first().isVisible()); i++) {
    await click(page, previous, 150);
  }
  await click(page, page.getByRole('button', { name: /September 1st, 2026/ }).first(), 300);
  await click(page, page.getByRole('button', { name: /October 31st, 2026/ }).first(), 300);
  await page.keyboard.press('Escape');
  await click(page, sheet.getByRole('button', { name: 'Run' }), 2500);
  await shot(page, 'laboratory-letterhead', { crop: page.locator('canvas').first(), pad: 0 });

  // --- Data exposure: hide one column -----------------------------------------------------------
  await open(page, '/studio/settings/data-exposure');
  await shot(page, 'data-exposure-tour');
  await clip(page, 'data-exposure-hide', async () => {
    await click(page, page.getByRole('switch', { name: 'toggle sex' }).first(), 600);
    await pageActions(page, 'Data Exposure', 'Save');
    await settle(page, 800);
  });
  // Put it back.
  await click(page, page.getByRole('switch', { name: 'toggle sex' }).first(), 400);
  await pageActions(page, 'Data Exposure', 'Save');
  void choose;
});
