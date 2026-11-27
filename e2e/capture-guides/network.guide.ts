// The clip for the Network guide (apps/studio/src/docs/0.1.8/<locale>/network.md).
//
// It needs a server with one trusted certificate and a few workflow hosts already there, and an
// HTTPS server it may read a certificate from. GUIDE_TRUST_ADDRESS names that server, such as
// `127.0.0.1:9443`. It reads the certificate and saves nothing, so it changes no data.
//
// The other guides run with AUTH_DEV_BYPASS. A standalone install has local sign-in instead, so
// with GUIDE_USER and GUIDE_PASSWORD set this script signs in through the form first.
import { expect, test, type Page } from '@playwright/test';

import { click, clip, open, prepareGuidePage, settle, type } from './kit';

const ADDRESS = process.env.GUIDE_TRUST_ADDRESS ?? '127.0.0.1:9443';

async function signIn(page: Page): Promise<void> {
  const user = process.env.GUIDE_USER;
  const password = process.env.GUIDE_PASSWORD;
  if (!user || !password) return;
  await page.goto('/studio/settings/network', { waitUntil: 'networkidle' });
  const field = page.locator('input[type="password"]');
  if (!(await field.isVisible().catch(() => false))) return;
  await page.getByRole('textbox').first().fill(user);
  await field.fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.locator('nav').first().waitFor({ state: 'visible', timeout: 30_000 });
}

test('network guide', async ({ page }) => {
  test.setTimeout(180_000);
  await prepareGuidePage(page);
  await signIn(page);
  await open(page, '/studio/settings/network');
  await expect(page.getByRole('tab', { name: 'Trusted certificates' })).toBeVisible();

  await clip(page, 'network-intro', async () => {
    await settle(page, 900);
    await click(page, page.getByTestId('network-menu'), 500);
    await click(page, page.getByRole('menuitem', { name: 'Add certificate' }), 900);
    const sheet = page.getByRole('dialog').first();
    await type(page, sheet.locator('#trust-address'), ADDRESS);
    await click(page, sheet.getByTestId('trust-sheet-menu'), 500);
    await click(page, page.getByRole('menuitem', { name: 'Read certificate' }), 600);
    await expect(sheet.getByTestId('trust-preview')).toBeVisible({ timeout: 20_000 });
    // Long enough to read the fingerprint, which is the thing the person compares.
    await settle(page, 2200);
    await page.keyboard.press('Escape');
    await settle(page, 600);
    await click(page, page.getByRole('tab', { name: 'Workflow hosts' }), 1400);
  });
});
