// Screenshots and clips for the Start here guide (apps/studio/src/docs/0.1.8/<locale>/start-here.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// The language clip switches to French and back. Nothing else changes.
import { expect, test, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, shot, type, VIEWPORT } from './kit';

async function userMenu(page: Page): Promise<void> {
  await click(page, page.getByText('dev-admin').first(), 400);
}

test('start here guide', async ({ page }) => {
  test.setTimeout(240_000);
  await prepareGuidePage(page);
  await open(page, '/studio');
  await expect(page.getByText('60', { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await shot(page, 'start-here-tour', {
    callouts: [
      { number: 1, selector: 'nav[aria-label="Primary"] a[href="/studio/workflows"]', offsetX: -6, offsetY: -12 },
      { number: 2, selector: 'button[aria-label="Open notifications"]', offsetX: -48, offsetY: 4 },
      { number: 3, selector: 'button[aria-label^="Switch to"]', offsetX: -14, offsetY: 30 },
      { number: 4, selector: 'text=dev-admin', offsetX: 10, offsetY: -6 },
      { number: 5, selector: 'button[aria-label="Collapse sidebar"], button[aria-label*="sidebar" i]', offsetX: -14, offsetY: 30 },
    ],
  });

  // --- Change the language ---------------------------------------------------------------------
  await clip(page, 'start-here-language', async () => {
    await userMenu(page);
    await click(page, page.getByRole('menuitem', { name: 'Language' }), 400);
    await click(page, page.getByText('Français', { exact: true }).first(), 1200);
    await settle(page, 800);
  });
  // Back to English for the rest of the captures.
  await userMenu(page);
  await click(page, page.getByRole('menuitem').filter({ hasText: /Langue|Language/ }).first(), 400);
  await click(page, page.getByText('English', { exact: true }).first(), 1000);

  // --- Use the docs -----------------------------------------------------------------------------
  await clip(page, 'start-here-docs', async () => {
    await click(page, page.getByRole('link', { name: 'Docs', exact: true }), 1200);
    await type(page, page.getByRole('textbox', { name: 'Search documentation' }), 'sample data');
    await settle(page, 500);
    await click(page, page.getByRole('navigation', { name: 'Documentation sections' }).getByRole('link', { name: 'Dashboards' }), 1200);
    await click(page, page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Load the sample data' }), 1500);
  });
  await click(page, page.getByRole('button', { name: 'Download documentation' }), 400);
  await click(page, page.getByRole('menuitem', { name: 'This page' }), 400);
  await shot(page, 'start-here-docs-download');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio');
  await click(page, page.getByRole('button', { name: 'Open menu' }), 800);
  await shot(page, 'start-here-phone-menu');
  await page.setViewportSize(VIEWPORT);
});
