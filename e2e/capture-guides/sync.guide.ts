// Screenshots and clips for the Distributed Sync guide (apps/studio/src/docs/0.1.8/<locale>/sync.md).
//
// Runs against one install, with sync switched off. Enrolling a lab needs a central server with a
// Keycloak admin client, and a second install to connect, so the guide's enrolment and connection
// steps are shown with the older static pictures. This script changes nothing.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot } from './kit';

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

test('sync guide', async ({ page }) => {
  test.setTimeout(200_000);
  await prepareGuidePage(page);

  // Central's Sites page and its menu.
  await open(page, '/studio/settings/sites');
  await clip(page, 'sync-sites-menu', async () => {
    await click(page, dots(page, page.locator('main')), 600);
    await settle(page, 1200);
  });
  console.log('SITES MENU', await page.getByRole('menuitem').allInnerTexts());
  await page.keyboard.press('Escape');

  // A lab's Distributed sync page: the Settings tab, then the Activity tab.
  await open(page, '/studio/settings/sync');
  await expect(page.getByText('Enable sync')).toBeVisible();
  await shot(page, 'sync-settings-tab');
  await clip(page, 'sync-activity', async () => {
    await click(page, page.getByRole('tab', { name: 'Activity' }), 1500);
    await settle(page, 1200);
  });
  console.log('ACTIVITY', (await page.locator('main').innerText()).slice(150, 1200));
  await shot(page, 'sync-activity-tab');
});
