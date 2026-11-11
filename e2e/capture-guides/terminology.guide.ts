// Screenshots and clips for the Terminology guide (apps/studio/src/docs/0.1.8/<locale>/terminology.md).
//
// Needs a fresh install, with the test catalog from test-catalog.guide.ts for the Lab order shot.
// It adds one test rejection reason to the REJECT-TEST code system and removes it again.
// Import terms… is not captured: in this release it imports nothing for a local code system.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

const SYSTEM_ID = 'cs-url-REJECT-TEST';
const ADDED = ['UNLABELLED'];

async function removeAdded(api: APIRequestContext): Promise<void> {
  for (const code of ADDED) await api.delete(`/api/terminology/systems/${SYSTEM_ID}/terms/${code}`);
}

test.beforeAll(async ({ request }) => removeAdded(request));
test.afterAll(async ({ request }) => removeAdded(request));

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

async function termMenu(page: Page, item: RegExp): Promise<void> {
  await click(page, dots(page, page.locator('main')), 350);
  await click(page, page.getByRole('menuitem', { name: 'Term', exact: true }), 400);
  await click(page, page.getByRole('menuitem', { name: item }), 900);
}

test('terminology guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/terminology');
  await shot(page, 'terminology-tour');

  // --- Example 1: browse a code system ---------------------------------------------------------
  await clip(page, 'terminology-browse', async () => {
    await click(page, page.getByRole('row').filter({ hasText: 'REJECT-TEST' }).first(), 1500);
    await expect(page.getByText('4 terms')).toBeVisible();
    await settle(page, 1000);
  });

  // --- Example 2: add one term ------------------------------------------------------------------
  await clip(page, 'terminology-add-term', async () => {
    await termMenu(page, /^New$/);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.locator('#termCode'), 'UNLABELLED');
    await type(page, sheet.locator('#termDisplay'), 'Unlabelled specimen');
    await click(page, dots(page, sheet), 350);
    await click(page, page.getByRole('menuitem', { name: /^(Create|Save)$/ }).first(), 1500);
    await expect(page.getByText('5 terms')).toBeVisible();
    await settle(page, 1000);
  });

  // The new reason, offered on the Lab order.
  await open(page, '/studio/forms/form-sample-order');
  const main = page.locator('main');
  await type(page, main.getByPlaceholder('Search tests…'), 'Full');
  await settle(page, 900);
  await click(page, page.getByRole('option', { name: /^Full blood count/ }).first(), 900);
  await click(page, main.getByRole('button', { name: 'Actions for Full blood count' }), 400);
  await click(page, page.getByRole('menuitem', { name: 'Reject with reason' }), 1000);
  const reject = page.getByRole('dialog').first();
  const picker = reject.getByRole('combobox').first();
  if (await picker.count()) await click(page, picker, 600);
  await expect(page.getByText('Unlabelled specimen').first()).toBeVisible();
  await shot(page, 'terminology-reason-in-order');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // --- Example 3: read the value sets ---------------------------------------------------------------
  await open(page, '/studio/terminology');
  await click(page, page.getByText('Value sets', { exact: true }).first(), 1200);
  await shot(page, 'terminology-value-sets');
});
