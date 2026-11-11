// Screenshots and clips for the Marketplace guide (apps/studio/src/docs/0.1.8/<locale>/marketplace.md).
//
// Needs network access to the default registry on GitHub. It installs the `tabular` plugin and
// removes it again.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot } from './kit';

const PLUGIN = 'tabular';

async function removeInstalled(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/marketplace/installed')).json()) as Array<{ id: string; name?: string; version?: string }> | { rows: Array<{ id: string; name?: string; version?: string }> };
  const rows = Array.isArray(list) ? list : list.rows;
  for (const p of rows) if (p.id === PLUGIN || p.name === PLUGIN) await api.delete(`/api/marketplace/${encodeURIComponent(p.id)}${p.version ? `?version=${encodeURIComponent(p.version)}` : ''}`);
}

test.beforeAll(async ({ request }) => removeInstalled(request));
test.afterAll(async ({ request }) => removeInstalled(request));

const dots = (page: Page, scope: Locator): Locator =>
  scope.getByRole('button').filter({ has: page.locator('svg.lucide-ellipsis, svg.lucide-more-horizontal') }).first();

test('marketplace guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/settings/marketplace');
  await expect(page.getByText(PLUGIN, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await shot(page, 'marketplace-tour');

  // --- Example 1: read a plugin before installing it ---------------------------------------------
  await clip(page, 'marketplace-read', async () => {
    await click(page, page.getByText(PLUGIN, { exact: true }).first(), 1000);
    await expect(page.getByText('read-input')).toBeVisible({ timeout: 30_000 });
    await settle(page, 1200);
  });
  await shot(page, 'marketplace-read-full');

  // --- Example 2: install it ---------------------------------------------------------------------
  await clip(page, 'marketplace-install', async () => {
    await click(page, dots(page, page.locator('main')), 350);
    await click(page, page.getByRole('menuitem', { name: 'Install', exact: true }), 1200);
    const approve = page.getByRole('dialog').first();
    await expect(approve.getByText('Requested capabilities')).toBeVisible();
    await settle(page, 1200);
    await click(page, approve.getByRole('button', { name: 'Approve & install' }), 3000);
    await settle(page, 1500);
  });
  await open(page, '/studio/settings/marketplace');
  await click(page, page.getByRole('tab', { name: /^Installed/ }), 1500);
  await expect(page.getByRole('tab', { name: 'Installed (1)' })).toBeVisible({ timeout: 30_000 });
  await shot(page, 'marketplace-installed');

  // --- Example 3: switch it off, then remove it -----------------------------------------------
  await clip(page, 'marketplace-remove', async () => {
    await click(page, page.getByText(PLUGIN, { exact: true }).first(), 1500);
    await click(page, dots(page, page.locator('main')), 400);
    console.log('INSTALLED MENU', await page.getByRole('menuitem').allInnerTexts());
    await click(page, page.getByRole('menuitem', { name: 'Remove', exact: true }), 1000);
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
    if (await confirm.count()) {
      console.log('REMOVE CONFIRM', await confirm.innerText());
      await click(page, confirm.getByRole('button', { name: /^Remove/ }).last(), 2000);
    }
    await settle(page, 1200);
  });
  await open(page, '/studio/settings/marketplace');
  await expect(page.getByRole('tab', { name: 'Installed (0)' })).toBeVisible({ timeout: 20_000 });

  // --- Registries ---------------------------------------------------------------------------------
  await click(page, page.getByRole('tab', { name: 'Registries' }), 1200);
  await shot(page, 'marketplace-registry-list');
  await click(page, dots(page, page.locator('main')), 350);
  await click(page, page.getByRole('menuitem', { name: 'Add registry' }), 1000);
  console.log('ADD REG', await page.getByRole('dialog').first().innerText());
  await shot(page, 'marketplace-add-registry');
  await page.keyboard.press('Escape');
});
