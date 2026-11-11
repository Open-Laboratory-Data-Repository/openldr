// Screenshots and clips for the Patients guide (apps/studio/src/docs/0.1.8/<locale>/patients.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// It labels the sample identifier system, then puts it back as a new install has it.
import { expect, test, type APIRequestContext } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type, VIEWPORT } from './kit';

const SYSTEM = 'urn:openldr:sample:patient';

async function resetSystem(api: APIRequestContext): Promise<void> {
  const res = await api.put('/api/patients/identifier-systems', {
    data: { system: SYSTEM, label: null, listColumn: false, searchable: true },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => resetSystem(request));
test.afterAll(async ({ request }) => resetSystem(request));

test('patients guide', async ({ page }) => {
  test.setTimeout(240_000);
  await prepareGuidePage(page);
  await open(page, '/studio/patients');
  await shot(page, 'patients-list');

  // --- Example 1: open a patient ----------------------------------------------------------------
  await clip(page, 'patients-sheet', async () => {
    await click(page, page.getByRole('row').filter({ hasText: 'Chausiku Demo' }).first(), 1500);
    await settle(page, 800);
  });
  await shot(page, 'patients-sheet-detail', { crop: page.getByRole('dialog').first(), pad: 0 });
  await page.keyboard.press('Escape');
  await settle(page, 300);

  // --- Example 2: label and show the sample identifier -------------------------------------------
  await clip(page, 'patients-identifier-system', async () => {
    await click(page, page.getByRole('tab', { name: 'Identifier systems' }), 800);
    const row = page.getByRole('row').filter({ hasText: SYSTEM }).first();
    await click(page, row.getByRole('button').last(), 400);
    await click(page, page.getByRole('menuitem', { name: 'Edit' }), 800);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.getByRole('textbox').first(), 'Sample ID');
    await click(page, sheet.getByRole('switch').or(sheet.getByRole('checkbox')).first(), 400);
    await click(page, sheet.getByRole('button', { name: /actions/i }).first(), 400);
    await click(page, page.getByRole('menuitem', { name: 'Save' }), 1000);
    await click(page, page.getByRole('tab', { name: 'Patients' }), 1000);
    await type(page, page.getByRole('searchbox', { name: 'Search name or identifier' }), 'SAMPLE-0007');
    await settle(page, 1200);
  });
  await shot(page, 'patients-search');

  // --- Duplicates ------------------------------------------------------------------------------
  await click(page, page.getByRole('tab', { name: 'Duplicates' }), 1200);
  await shot(page, 'patients-duplicates');

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio/patients');
  await shot(page, 'patients-phone');
  await page.setViewportSize(VIEWPORT);
});
