// Screenshots and clips for the Test catalog guide (apps/studio/src/docs/0.1.8/<locale>/test-catalog.md).
//
// Needs a fresh install with the docs sample data loaded and an EMPTY test catalog (see README.md
// beside this file). It imports apps/web/public/docs-samples/openldr-sample-test-catalog.csv,
// switches the five sample tests on at this lab and maps the five sample order codes.
//
// It does not undo that. A test can be retired but not deleted, and the Forms guide's Lab order
// needs these tests switched on. Run it before forms.guide.ts, once per fresh install.
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot } from './kit';

const CSV = fileURLToPath(new URL('../../apps/web/public/docs-samples/openldr-sample-test-catalog.csv', import.meta.url));
/** The five tests in the docs sample data: catalog name, and the LOINC code the sample orders use. */
const SAMPLE = [
  ['Full blood count', '58410-2'],
  ['Malaria rapid test', '70569-9'],
  ['HIV viral load', '20447-9'],
  ['Blood glucose', '2345-7'],
  ['Creatinine', '2160-0'],
] as const;

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function sheetMenu(page: Page, item: string): Promise<void> {
  await click(page, dots(page, page.getByRole('dialog').first()), 350);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 1000);
}

async function rowMenu(page: Page, rowText: string, item: string): Promise<void> {
  const row = page.getByRole('row').filter({ hasText: rowText }).first();
  await click(page, row.getByRole('button').last(), 350);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 900);
}

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/test-catalog?limit=1');
  const body = (await res.json()) as { total: number };
  expect(body.total, 'the test catalog must be empty: run this on a fresh install').toBe(0);
});

test('test catalog guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/test-catalog');

  // --- Example 1: import the sample list --------------------------------------------------------
  await clip(page, 'test-catalog-import', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'Import', exact: true }), 800);
    const sheet = page.getByRole('dialog').first();
    await sheet.locator('input[type=file]').setInputFiles(CSV);
    await settle(page, 1500);
    await sheetMenu(page, 'Next');
    await click(page, sheet.getByRole('combobox').first(), 400);
    await click(page, page.getByRole('option', { name: 'Add as a new category' }), 700);
    await sheetMenu(page, 'Next');
    await expect(sheet.getByText('Step 4 of 4')).toBeVisible();
    await settle(page, 1500);
  });
  await shot(page, 'test-catalog-review');
  await sheetMenu(page, 'Apply');
  await settle(page, 1500);
  if (await page.getByRole('dialog').count()) await sheetMenu(page, 'Close');
  await expect(page.getByRole('row').filter({ hasText: 'CSF culture' })).toBeVisible();
  await shot(page, 'test-catalog-list');

  // --- Example 2: switch the sample tests on at this lab ----------------------------------------
  await clip(page, 'test-catalog-switch-on', async () => {
    await rowMenu(page, 'Full blood count', 'Switch on at this lab');
    await settle(page, 1200);
  });
  for (const [name] of SAMPLE.slice(1)) await rowMenu(page, name, 'Switch on at this lab');

  // --- Example 3: map the lab's order codes -----------------------------------------------------
  await click(page, page.getByRole('tab', { name: 'Observed' }), 1200);
  await shot(page, 'test-catalog-observed');
  await clip(page, 'test-catalog-map', async () => {
    await rowMenu(page, SAMPLE[0][1], 'Map to catalog test');
    const sheet = page.getByRole('dialog').first();
    await click(page, sheet.getByRole('button', { name: 'Choose a catalog test' }), 400);
    await page.keyboard.type(SAMPLE[0][0], { delay: 40 });
    await click(page, page.getByRole('button', { name: new RegExp(`^${SAMPLE[0][0]} \\(`) }).first(), 600);
    await sheetMenu(page, 'Save');
    await settle(page, 1500);
  });
  for (const [name, code] of SAMPLE.slice(1)) {
    await rowMenu(page, code, 'Map to catalog test');
    const sheet = page.getByRole('dialog').first();
    await click(page, sheet.getByRole('button', { name: 'Choose a catalog test' }), 300);
    await page.keyboard.type(name, { delay: 10 });
    await click(page, page.getByRole('button', { name: new RegExp(`^${name} \\(`) }).first(), 400);
    await sheetMenu(page, 'Save');
  }
  await settle(page, 1200);
  await shot(page, 'test-catalog-mapped');
});
