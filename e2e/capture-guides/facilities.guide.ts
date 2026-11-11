// Screenshots and clips for the Facilities guide (apps/studio/src/docs/0.1.8/<locale>/facilities.md).
//
// Needs a fresh install with the docs sample data loaded and NO facility register yet (see
// README.md beside this file). It registers "Sample facility register", imports
// apps/web/public/docs-samples/openldr-sample-facilities.csv into it, and links the four facility
// codes the docs sample data uses.
//
// It does not undo that: a register cannot be removed from the studio, and the import's value
// decisions are stored against the register. Run it once per fresh install.
import { fileURLToPath } from 'node:url';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const CSV = fileURLToPath(new URL('../../apps/web/public/docs-samples/openldr-sample-facilities.csv', import.meta.url));
const REGISTER_URL = 'urn:openldr:cs:facility-register:sample';
const REGISTER_NAME = 'Sample facility register';

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function pick(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await click(page, trigger, 400);
  const name = typeof option === 'string' ? option : option;
  await click(page, page.getByRole('option', { name, exact: typeof option === 'string' }).first(), 600);
}

test.beforeAll(async ({ request }) => {
  const res = await request.get('/api/facilities/import/sources');
  const body = (await res.json()) as { rows: unknown[] };
  expect(body.rows.length, 'there must be no facility register yet: run this on a fresh install').toBe(0);
});

test('facilities guide', async ({ page }) => {
  test.setTimeout(400_000);
  await prepareGuidePage(page);
  await open(page, '/studio/facilities');
  const wizard = page.getByRole('dialog').first();

  // --- Example 1, part 1: register the source and upload the file ------------------------------
  await clip(page, 'facilities-register', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'Import facilities' }), 900);
    await page.locator('input[type=file]').first().setInputFiles(CSV);
    await settle(page, 900);
    await click(page, wizard.getByRole('button', { name: 'Register a source' }), 900);
    const reg = page.getByRole('dialog').last();
    await type(page, reg.locator('#register-source-url'), REGISTER_URL);
    await type(page, reg.locator('#register-source-name'), REGISTER_NAME);
    await type(page, reg.locator('#register-source-code'), 'SAMPLE');
    await click(page, dots(page, reg), 350);
    await click(page, page.getByRole('menuitem', { name: 'Register', exact: true }), 1500);
    const system = wizard.getByRole('combobox').first();
    if ((await system.innerText()).includes('Select a register')) await pick(page, system, REGISTER_NAME);
    await click(page, wizard.getByRole('button', { name: 'Continue' }), 2500);
    await expect(wizard.getByText('Facility Code', { exact: true })).toBeVisible();
    await settle(page, 800);
  });
  await shot(page, 'facilities-mapping');

  // --- Example 1, part 2: fix the map and check the file ----------------------------------------
  await clip(page, 'facilities-check', async () => {
    await pick(page, wizard.getByRole('combobox').nth(6), 'status');
    const country = wizard.getByPlaceholder('Type or pick a value').first();
    await click(page, country, 300);
    await page.keyboard.type('Tanzania', { delay: 40 });
    await click(page, page.getByRole('option', { name: /Tanzania/ }).first(), 600);
    await click(page, wizard.getByRole('button', { name: 'Validate all' }), 5000);
    await expect(wizard.getByText('Values with no canonical mapping')).toBeVisible({ timeout: 20_000 });
    await settle(page, 1200);
  });
  await shot(page, 'facilities-review-values');

  // --- Example 1, part 3: decide the unrecognised values ----------------------------------------
  await clip(page, 'facilities-values', async () => {
    await click(page, wizard.getByRole('button', { name: 'Map these values' }), 2000);
    const combos = wizard.getByRole('combobox');
    await pick(page, combos.nth(3), 'Ignore this value');
    await pick(page, combos.nth(8), 'Active');
    await pick(page, combos.nth(9), 'Inactive');
    await click(page, wizard.getByRole('button', { name: 'Validate all' }), 5000);
    await expect(wizard.getByText(/10 facility row\(s\) will be created/)).toBeVisible({ timeout: 20_000 });
    await settle(page, 1200);
  });
  await shot(page, 'facilities-review');
  await click(page, wizard.getByRole('button', { name: 'Confirm import' }), 4000);
  await expect.poll(async () => {
    const res = await page.request.get('/api/facilities?limit=50');
    const body = (await res.json()) as { total?: number; rows?: unknown[] };
    return body.total ?? body.rows?.length ?? 0;
  }, { timeout: 60_000 }).toBeGreaterThanOrEqual(10);
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  await open(page, '/studio/facilities');
  await settle(page, 1200);
  await shot(page, 'facilities-registry');

  // --- Example 2: link the sample data's facility codes -----------------------------------------
  await click(page, page.getByRole('tab', { name: 'Observed' }), 1500);
  await shot(page, 'facilities-observed');
  await clip(page, 'facilities-link', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'Link matching codes' }), 900);
    const sheet = page.getByRole('dialog').first();
    await pick(page, sheet.getByRole('combobox').first(), REGISTER_NAME);
    await expect(sheet.getByText(/4 to link/)).toBeVisible({ timeout: 15_000 });
    await settle(page, 1000);
    await click(page, dots(page, sheet), 350);
    await click(page, page.getByRole('menuitem', { name: 'Link 4 codes' }), 2500);
    await settle(page, 1200);
  });
  await open(page, '/studio/facilities');
  await click(page, page.getByRole('tab', { name: 'Observed' }), 2000);
  await shot(page, 'facilities-linked');
});
