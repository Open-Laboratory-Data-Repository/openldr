const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const { chromium, expect } = require(path.join(repo, 'e2e/node_modules/@playwright/test'));
const app = 'http://127.0.0.1:5190/studio';
const sizes = [[320,640], [375,812], [393,812], [767,700], [768,700], [1024,768], [1280,800], [1920,1080]];
const out = __dirname;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const proof = { sizes: [], locales: [], browserErrors: [], mutations: [], limits: 'Headless layout and input checks. Physical phone browser chrome was not tested.' };
  let page;
  async function open(width, height, locale = 'en') {
    const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 4 });
    // Override only this browser's read response. No account preferences are saved.
    await p.route('**/api/me/preferences', async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), language: locale } });
    });
    p.on('pageerror', e => proof.browserErrors.push(e.message));
    p.on('request', r => { if (['POST','PUT','PATCH','DELETE'].includes(r.method())) proof.mutations.push({ method: r.method(), url: r.url() }); });
    await p.goto(app + '/docs/test-catalog');
    const title = fs.readFileSync(path.join(repo, 'apps/studio/src/docs/0.1.8', locale, 'test-catalog.md'), 'utf8').match(/^# (.+)$/m)[1];
    await expect(p.locator('.doc-content h1')).toHaveText(title);
    return p;
  }
  async function checkVersion(p) {
    const search = p.getByRole('textbox', { name: 'Search documentation' });
    const version = p.getByRole('combobox', { name: 'Documentation version' });
    await expect(version).toBeVisible();
    const searchBox = await search.boundingBox(), box = await version.boundingBox();
    const value = await version.locator('span').nth(1).boundingBox(), arrow = await version.locator('svg').boundingBox();
    if (box.y < searchBox.y + searchBox.height - 1) throw Error('Version is not below Search');
    const gap = arrow.x - value.x - value.width;
    if (gap < -1 || gap > 8) throw Error('Version value is not right aligned: gap ' + gap);
    await version.click();
    await expect(p.getByRole('option', { name: '0.1.0', exact: true })).toBeVisible();
    await p.getByRole('option', { name: '0.1.8', exact: true }).click();
    await expect(version).toContainText('0.1.8');
    await expect(p.getByRole('listbox')).not.toBeVisible();
    await expect(version).toBeFocused();
    return { belowSearch: true, valueRightGap: gap, versionMenuPassed: true };
  }
  try {
    for (const [width, height] of sizes) {
      page = await open(width, height);
      const pane = page.locator('.doc-content').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
      await pane.evaluate(e => e.scrollTop = 300);
      const before = await pane.boundingBox();
      const expand = page.getByRole('button', { name: 'Expand documentation sidebar' });
      const openTarget = await expand.count() ? await expand.boundingBox() : null;
      if (await expand.count()) await expand.click();
      if (width < 768) {
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        const after = await pane.boundingBox();
        if (Math.abs(before.width - after.width) > 1 || Math.abs(before.x - after.x) > 1) throw Error('Drawer changed article width');
        const closeTarget = await drawer.getByRole('button', { name: 'Collapse documentation sidebar' }).boundingBox();
        if (openTarget.width < 44 || openTarget.height < 44 || closeTarget.width < 44 || closeTarget.height < 44) throw Error('Phone navigation tap target below 44px');
        const version = await checkVersion(page);
        const links = drawer.getByRole('navigation', { name: 'Documentation sections' }).getByRole('link');
        await drawer.getByRole('button', { name: 'Collapse documentation sidebar' }).focus();
        await expect(drawer.getByRole('button', { name: 'Collapse documentation sidebar' })).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(links.last()).toBeFocused();
        await links.last().scrollIntoViewIfNeeded();
        await expect(links.last()).toBeInViewport();
        await expect.poll(() => pane.evaluate(e => e.scrollTop)).toBe(300);
        await page.getByRole('combobox', { name: 'Documentation version' }).focus();
        await page.screenshot({ path: path.join(out, 'phone-open-' + width + '.png') });
        await page.keyboard.press('Escape');
        await expect(drawer).not.toBeVisible();
        await expect(page.getByRole('button', { name: 'Expand documentation sidebar' })).toBeFocused();
        await expect.poll(() => pane.evaluate(e => e.scrollTop)).toBe(300);
        await page.getByRole('button', { name: 'Expand documentation sidebar' }).click();
        await page.mouse.click(width - 8, Math.floor(height / 2));
        await expect(drawer).not.toBeVisible();
        await page.getByRole('button', { name: 'Expand documentation sidebar' }).click();
        await drawer.getByRole('textbox', { name: 'Search documentation' }).fill('Facilities');
        await drawer.getByRole('link', { name: 'Facilities', exact: true }).click();
        await expect(drawer).not.toBeVisible();
        await expect(page.locator('.doc-content h1')).toHaveText('Facilities');
        await page.screenshot({ path: path.join(out, 'phone-reading-' + width + '.png') });
        proof.sizes.push({ width, height, ...version, articleWidthBefore: before.width, articleWidthOpen: after.width, lastGuideReachable: true, escapeFocusReturn: true, outsideClickCloses: true, searchAndSelectionCloses: true, focusTrapped: true, toggleTapTargets: 44 });
      } else {
        await expect(page.getByRole('dialog')).toHaveCount(0);
        const version = await checkVersion(page);
        await page.getByRole('navigation', { name: 'Documentation sections' }).getByRole('link', { name: 'Facilities', exact: true }).click();
        await expect(page.locator('.doc-content h1')).toHaveText('Facilities');
        await expect(page.getByRole('navigation', { name: 'Documentation sections' })).toBeVisible();
        await page.screenshot({ path: path.join(out, 'desktop-' + width + '.png') });
        proof.sizes.push({ width, height, ...version, inlineNavigationPreserved: true });
      }
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Horizontal page overflow');
      console.log('PASS ' + width + 'x' + height);
      await page.close();
    }
    page = await open(393,812);
    await page.getByRole('button', { name: 'Expand documentation sidebar' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Documentation sections' })).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.getByRole('navigation', { name: 'Documentation sections' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Expand documentation sidebar' })).toBeVisible();
    proof.resizeOpenDrawer = true;
    await page.close();
    for (const locale of ['fr', 'pt']) {
      page = await open(375,812,locale);
      const pane = page.locator('.doc-content').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
      const before = await pane.boundingBox();
      await page.getByRole('button', { name: 'Expand documentation sidebar' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const after = await pane.boundingBox();
      if (Math.abs(before.width-after.width)>1) throw Error(locale + ' drawer changed article width');
      proof.locales.push({ locale, ...await checkVersion(page), articleWidthUnchanged: true });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.close();
    }
    if (proof.browserErrors.length || proof.mutations.length) throw Error('Unexpected errors or writes ' + JSON.stringify(proof));
    fs.writeFileSync(path.join(out, 'browser-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('DOCS NAVIGATION PASS: 8 sizes; overlay preserves article width; search/selection, Escape, outside click, resize and versions; en/fr/pt; no server writes');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(out, 'failure.png') });
    if (page && !page.isClosed()) console.error(await page.evaluate(() => ({ focused: document.activeElement?.outerHTML.slice(0, 400), url: location.href })));
    throw error;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
