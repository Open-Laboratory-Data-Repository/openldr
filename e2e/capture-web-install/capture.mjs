// Run only against the disposable realm described in README.md.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.INSTALL_GUIDE_ISOLATED !== 'yes') throw new Error('Create the disposable authentication fixture first. See README.md.');
const authBase = process.env.INSTALL_GUIDE_AUTH_URL ?? 'http://127.0.0.1:18591/auth';
const studioBase = process.env.INSTALL_GUIDE_STUDIO_URL ?? 'http://127.0.0.1:5173';
if (!['localhost', '127.0.0.1'].includes(new URL(authBase).hostname)) throw new Error('Use a local disposable realm, not a shared server.');
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));
const out = 'apps/web/public/docs-images/install';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
try {
  for (const theme of ['dark', 'light']) {
    const file = name => `${out}/${name}${theme === 'light' ? '-light' : ''}.png`;
    const authContext = await browser.newContext({ viewport: { width: 1008, height: 568 }, deviceScaleFactor: 3, colorScheme: theme });
    try {
      const page = await authContext.newPage();
      const login = new URL(`${authBase}/realms/openldr/protocol/openid-connect/auth`);
      login.search = new URLSearchParams({ client_id: 'openldr-web', redirect_uri: 'http://localhost:5173/studio/auth/callback', response_type: 'code', scope: 'openid', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' }).toString();
      await page.goto(login.href);
      await page.getByLabel('Username or email').waitFor();
      await page.addStyleTag({ content: 'body { zoom: 1.3; }' });
      await page.screenshot({ path: file('sign-in') });
      await page.getByLabel('Username or email').fill('labadmin');
      await page.getByLabel('Password', { exact: true }).fill('labadmin');
      await page.screenshot({ path: file('credentials') });
      await page.locator('input[type="submit"]').click();
      await page.locator('#password-new').waitFor();
      await page.locator('#password-new').fill('Documentation-example-2026!');
      await page.locator('#password-confirm').fill('Documentation-example-2026!');
      await page.screenshot({ path: file('password') });
      // Do not submit the change. Both captures need the initial-password prompt.
    } finally { await authContext.close(); }
    const studioContext = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
    try {
      const page = await studioContext.newPage();
      await page.route('**/api/me/preferences', route => route.fulfill({ json: { theme, sidebarCollapsed: false, language: 'en' } }));
      await page.addInitScript(selected => {
        localStorage.setItem('openldr-theme', selected);
        localStorage.setItem('openldr-sidebar-collapsed', 'false');
        localStorage.setItem('openldr-locale', 'en');
        localStorage.setItem('i18nextLng', 'en');
      }, theme);
      await page.goto(`${studioBase}/studio/docs/start-here`);
      const link = page.locator('a[href="/studio/docs"]').first();
      await link.waitFor();
      await link.scrollIntoViewIfNeeded();
      await page.getByRole('heading', { name: 'Start here', exact: true }).waitFor();
      await page.addStyleTag({ content: '*,*::before,*::after {animation:none!important;transition:none!important;caret-color:transparent!important} a[href="/studio/docs"] {outline:2px solid var(--primary);outline-offset:-2px}' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: file('studio-docs') });
    } finally { await studioContext.close(); }
    process.stdout.write(`Captured four ${theme} browser screenshots.\n`);
  }
} finally { await browser.close(); }
