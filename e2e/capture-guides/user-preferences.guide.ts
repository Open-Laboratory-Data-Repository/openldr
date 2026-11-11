// Screenshots and clips for the Your preferences guide (apps/studio/src/docs/0.1.8/<locale>/user-preferences.md).
//
// Preferences are saved to the signed-in account, which every guide script shares, so this script
// reads them first and puts them back at the end.
import { expect, test, type APIRequestContext } from '@playwright/test';

import { click, clip, open, point, prepareGuidePage, settle, shot } from './kit';

let saved: Record<string, unknown> = {};

async function restore(api: APIRequestContext): Promise<void> {
  const body = {
    theme: saved.theme ?? null,
    sidebarCollapsed: saved.sidebarCollapsed ?? null,
    startPage: saved.startPage ?? null,
    language: saved.language ?? null,
  };
  const res = await api.put('/api/me/preferences', { data: body });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  saved = (await (await request.get('/api/me/preferences')).json()) as Record<string, unknown>;
});
test.afterAll(async ({ request }) => restore(request));

test('user preferences guide', async ({ page }) => {
  test.setTimeout(200_000);
  await prepareGuidePage(page);
  await open(page, '/studio/');

  // --- Example 1: open on Reports ---------------------------------------------------------------
  await clip(page, 'user-preferences-start-page', async () => {
    await click(page, page.getByRole('button', { name: /Open user menu/ }), 500);
    await point(page, page.getByRole('menuitem', { name: /Start page/ }));
    await page.getByRole('menuitem', { name: /Start page/ }).hover();
    await settle(page, 800);
    // A direct click: the animated cursor's diagonal path would cross Settings and close the submenu.
    await page.getByRole('menuitem', { name: 'Reports', exact: true }).last().click();
    await settle(page, 1200);
  });
  await page.keyboard.press('Escape');
  // Sign in again: open the main address.
  await open(page, '/studio/');
  await expect(page).toHaveURL(/\/studio\/reports/);
  await settle(page, 1200);
  await shot(page, 'user-preferences-reports-first');

  // --- Example 2: theme -------------------------------------------------------------------------
  await clip(page, 'user-preferences-theme', async () => {
    await click(page, page.getByRole('button', { name: /Switch to light mode/ }), 1200);
    await settle(page, 800);
  });
  await shot(page, 'user-preferences-light');

  // --- Example 3: language ----------------------------------------------------------------------
  await clip(page, 'user-preferences-language', async () => {
    await click(page, page.getByRole('button', { name: /Open user menu/ }), 500);
    await point(page, page.getByRole('menuitem', { name: /Language/ }));
    await page.getByRole('menuitem', { name: /Language/ }).hover();
    await settle(page, 800);
    await page.getByRole('menuitem', { name: /Français/ }).last().click();
    await settle(page, 1500);
    await settle(page, 1000);
  });
  await page.keyboard.press('Escape');
  await shot(page, 'user-preferences-french');
  const prefs = (await (await page.request.get('/api/me/preferences')).json()) as Record<string, unknown>;
  console.log('SAVED', JSON.stringify(prefs));
});
