const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const { chromium, expect } = require(path.join(repo, 'e2e/node_modules/@playwright/test'));
const app = process.env.DOCS_SCROLL_STUDIO_URL || 'http://127.0.0.1:5190';
if (!['127.0.0.1', 'localhost'].includes(new URL(app).hostname)) throw Error('Use local Studio');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 4 });
  const proof = { sizes: [], limits: 'Headless browser layout only. Physical phone chrome was not tested.' };
  try {
    await page.goto(app + '/studio/docs/test-catalog');
    await expect(page.locator('.doc-content h1')).toHaveText('Test catalog');
    const nav = page.getByRole('navigation', { name: 'On this page', exact: true });
    const links = nav.getByRole('link');
    await expect(links).toHaveCount(17);
    for (const height of [1100, 500, 350, 1100]) {
      await page.setViewportSize({ width: 1600, height });
      const pane = page.locator('.doc-content').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
      await pane.evaluate(e => e.scrollTop = 0);
      await expect.poll(() => nav.evaluate(e => getComputedStyle(e).position)).toBe(height === 1100 ? 'sticky' : 'static');
      const state = await nav.evaluate(e => {
        const descendants = [e, ...e.querySelectorAll('*')];
        return { height: innerHeight, navHeight: e.offsetHeight, position: getComputedStyle(e).position, scrollAreas: descendants.filter(n => ['auto', 'scroll'].includes(getComputedStyle(n).overflowY)).length };
      });
      if (state.scrollAreas !== 0) throw Error('Contents still has an independent scroll area: ' + JSON.stringify(state));
      if (height === 500) await page.screenshot({ path: path.join(__dirname, 'short-window-menu.png') });
      const before = await pane.evaluate(e => e.scrollTop);
      const bounds = await nav.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, Math.min(bounds.y + 80, height - 50));
      await page.mouse.wheel(0, 240);
      await expect.poll(() => pane.evaluate(e => e.scrollTop)).toBeGreaterThan(before);
      if (height === 1100) {
        const target = links.nth(12);
        const id = (await target.getAttribute('href')).slice(1);
        await page.locator('[id="' + id + '"]').evaluate(e => e.scrollIntoView({ block: 'start' }));
        await expect(target).toHaveAttribute('aria-current', 'location');
        await expect(target).toBeInViewport();
      } else {
        await pane.evaluate(e => e.scrollTop = 0);
        const last = links.last();
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport();
        state.paneScrollForLastLink = await pane.evaluate(e => e.scrollTop);
        if (state.paneScrollForLastLink <= 0) throw Error('Last task did not use article scrolling');
        state.innerScrollTop = await nav.evaluate(e => Math.max(...[e, ...e.querySelectorAll('*')].map(n => n.scrollTop)));
        if (state.innerScrollTop !== 0) throw Error('Contents scrolled independently');
        await last.click();
        await expect(page.locator('.doc-content h2').last()).toBeInViewport();
      }
      await page.screenshot({ path: path.join(__dirname, 'desktop-' + height + '.png') });
      proof.sizes.push(state);
    }
    await page.setViewportSize({ width: 1600, height: 500 });
    const pane = page.locator('.doc-content').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
    // Shorten only the browser DOM to check that the menu itself can create page overflow.
    await page.locator('.doc-content').locator('..').evaluate(e => { e.style.height = '1px'; e.style.overflow = 'hidden'; });
    await pane.evaluate(e => e.scrollTop = 0);
    await expect.poll(() => nav.evaluate(e => getComputedStyle(e).position)).toBe('static');
    proof.shortArticle = await pane.evaluate(e => ({ height: e.clientHeight, scrollHeight: e.scrollHeight }));
    if (proof.shortArticle.scrollHeight <= proof.shortArticle.height) throw Error('Tall menu did not create page overflow');
    await links.last().scrollIntoViewIfNeeded();
    await expect(links.last()).toBeInViewport();
    proof.shortArticle.lastTaskReachedWithPageScroll = await pane.evaluate(e => e.scrollTop > 0);
    if (!proof.shortArticle.lastTaskReachedWithPageScroll) throw Error('Short article used another scrollbar');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(app + '/studio/docs/test-catalog');
    await expect(page.locator('.doc-content h1')).toHaveText('Test catalog');
    await page.getByRole('button', { name: 'On this page', exact: true }).click();
    await expect(page.getByRole('menuitem')).toHaveCount(17);
    proof.phone = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > innerWidth }));
    if (proof.phone.horizontalOverflow) throw Error('Phone page overflow');
    await page.screenshot({ path: path.join(__dirname, 'phone-menu.png') });
    fs.writeFileSync(path.join(__dirname, 'browser-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('SHARED SCROLL PASS: four resize checks; wheel scrolls article; all tasks reachable; active task highlighted; phone menu has 17 tasks');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
