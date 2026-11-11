// Screenshots and clips for the Users and Roles guides
// (apps/studio/src/docs/0.1.8/<locale>/users.md and roles.md).
//
// The user list comes from the identity provider, so this script only looks: it opens a
// user's sheet and closes it without saving. It makes one role, "Dashboard viewer", in the
// OpenLDR database, and deletes it afterwards.
import { test, type APIRequestContext } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type, VIEWPORT } from './kit';

const ROLE = 'Dashboard viewer';

async function removeRole(api: APIRequestContext): Promise<void> {
  const res = await api.get('/api/roles');
  if (!res.ok()) return;
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : (body as { roles?: unknown[] }).roles ?? []) as Array<{ id: string; name: string }>;
  for (const r of list) if (r.name === ROLE) await api.delete(`/api/roles/${r.id}`);
}

test.beforeAll(async ({ request }) => removeRole(request));
test.afterAll(async ({ request }) => removeRole(request));

test('users and roles guides', async ({ page }) => {
  test.setTimeout(240_000);
  await prepareGuidePage(page);

  // --- Users -----------------------------------------------------------------------------------
  await open(page, '/studio/users');
  await shot(page, 'users-tour');
  await click(page, page.getByRole('button', { name: 'Actions for labadmin' }), 400);
  await shot(page, 'users-row-menu', { crop: page.getByRole('menu').first(), pad: 6 });
  await click(page, page.getByRole('menuitem', { name: 'Edit' }), 1200);
  await shot(page, 'users-edit-sheet', { crop: page.getByRole('dialog').first(), pad: 0 });
  await page.keyboard.press('Escape');
  await settle(page, 300);

  // --- Roles -----------------------------------------------------------------------------------
  await open(page, '/studio/settings/roles');
  await shot(page, 'roles-tour');
  await clip(page, 'roles-create', async () => {
    await click(page, page.getByRole('button', { name: 'Actions', exact: true }), 400);
    await click(page, page.getByRole('menuitem', { name: 'Create role' }), 900);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.getByRole('textbox', { name: 'Name' }), ROLE);
    await type(page, sheet.getByRole('textbox', { name: 'Description' }), 'Reads dashboards and runs reports. Changes nothing.');
    await click(page, sheet.getByRole('switch', { name: 'View dashboards' }), 300);
    await click(page, sheet.getByRole('switch', { name: 'View reports' }), 300);
    await click(page, sheet.getByRole('switch', { name: 'Run reports' }), 300);
    await click(page, sheet.getByRole('button', { name: 'Actions' }).first(), 400);
    await click(page, page.getByRole('menuitem', { name: 'Create' }), 1200);
    await settle(page, 800);
  });

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio/users');
  await shot(page, 'users-phone');
  await page.setViewportSize(VIEWPORT);
});
