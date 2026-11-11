// Screenshots and clips for the Forms guide (apps/studio/src/docs/0.1.8/<locale>/forms.md).
//
// Needs the docs sample data, and the test catalog from test-catalog.guide.ts (the Lab order's
// Tests field lists only tests switched on at this lab). Run it LAST: Example 1 submits a real
// Lab order, which adds a 61st order to the warehouse and cannot be removed. The form Example 2
// builds is deleted again at the end.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const BUILT = 'Quick viral load request';

async function removeBuilt(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/forms')).json()) as Array<{ id: string; name: string }>;
  for (const f of list) if (f.name === BUILT) await api.delete(`/api/forms/${f.id}`);
}

test.beforeAll(async ({ request }) => removeBuilt(request));
test.afterAll(async ({ request }) => removeBuilt(request));

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function builderAction(page: Page, item: string): Promise<void> {
  await click(page, page.getByRole('button', { name: 'Builder actions' }), 350);
  await click(page, page.getByRole('menuitem', { name: item, exact: true }), 1200);
}

test('forms guide', async ({ page }) => {
  test.setTimeout(400_000);
  await prepareGuidePage(page);
  await open(page, '/studio/forms');
  await shot(page, 'forms-tour');

  // --- Example 1: take a lab order ---------------------------------------------------------------
  // GUIDE_SKIP_ORDER=1 skips this example, so a rerun after a later failure adds no second order.
  if (!process.env.GUIDE_SKIP_ORDER) {
  await clip(page, 'forms-lab-order', async () => {
    const row = page.getByRole('row').filter({ hasText: 'Lab order' }).first();
    await click(page, row.getByRole('button').last(), 350);
    await click(page, page.getByRole('menuitem', { name: 'View/Run' }), 1500);
    const main = page.locator('main');
    await type(page, main.getByPlaceholder('Search by name, ID, or phone…'), 'Chausiku');
    await settle(page, 1000);
    await click(page, page.getByRole('option', { name: /^Demo Chausiku/ }).first(), 700);
    await type(page, main.getByPlaceholder('Search tests…'), 'Full');
    await settle(page, 900);
    await click(page, page.getByRole('option', { name: /^Full blood count/ }).first(), 900);
    await click(page, main.getByRole('button', { name: 'FBC Full blood count Specimen type not set' }), 900);
    const sheet = page.getByRole('dialog').first();
    await choose(page, sheet.getByRole('combobox').first(), 'Blood');
    await page.keyboard.press('Escape');
    await settle(page, 600);
    await choose(page, main.getByRole('combobox').filter({ hasText: 'Select...' }).first(), 'Routine');
    await settle(page, 800);
  });
  await shot(page, 'forms-lab-order-filled');
  await clip(page, 'forms-lab-order-submit', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'Submit', exact: true }), 2500);
    await expect(page.getByText(/Response captured/i).first()).toBeVisible({ timeout: 20_000 });
    await settle(page, 1200);
  });
  }

  // --- Example 2: build a form from a starter pack -----------------------------------------------
  await open(page, '/studio/forms');
  await clip(page, 'forms-build', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'New', exact: true }), 1200);
    await type(page, page.locator('#builder-name'), BUILT);
    await choose(page, page.getByRole('combobox', { name: 'FHIR Version' }), 'R4 (most common)');
    await click(page, page.getByRole('combobox', { name: 'Resource Type' }), 400);
    await page.keyboard.type('ServiceRequest', { delay: 30 });
    await click(page, page.getByRole('option', { name: 'ServiceRequest', exact: true }), 1500);
    const pack = page.getByRole('dialog').first();
    for (const name of ['Requesting Clinician', 'Clinical Notes', 'Referring Facility', 'Order rejection']) {
      await click(page, pack.getByRole('checkbox', { name }), 250);
    }
    await click(page, dots(page, pack), 350);
    await click(page, page.getByRole('menuitem', { name: 'Add 5 fields' }), 1500);
    await settle(page, 800);
  });
  await shot(page, 'forms-builder');
  await clip(page, 'forms-preview', async () => {
    await builderAction(page, 'Preview');
    const sheet = page.getByRole('dialog').first();
    await click(page, dots(page, sheet), 350);
    await click(page, page.getByRole('menuitem', { name: 'Fill example' }), 1500);
    await settle(page, 1000);
  });
  await shot(page, 'forms-preview-filled');
  await page.keyboard.press('Escape');
  await settle(page, 500);
  await clip(page, 'forms-publish', async () => {
    await builderAction(page, 'Publish');
    await settle(page, 2000);
  });
  await open(page, '/studio/forms');
  await expect(page.getByRole('row').filter({ hasText: BUILT })).toBeVisible();
  await shot(page, 'forms-list-published');
});
