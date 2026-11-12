const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require(path.resolve(__dirname, '../../../../e2e/node_modules/@playwright/test'));
const app = 'http://127.0.0.1:5190/studio';
const api = 'http://127.0.0.1:3010/api';
const sizes = [[1600, 500], [1920, 1080], [1440, 350], [1280, 720], [1600, 300], [1600, 1100], [1279, 720], [1024, 600], [375, 812]];
async function preferences(body) {
  const r = await fetch(api + '/me/preferences', body ? { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  if (!r.ok) throw Error('Isolated preferences ' + r.status);
  return r.json();
}
(async () => {
  const saved = await preferences();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 500 }, deviceScaleFactor: 4 });
  const proof = { sizes: [], locales: [], limits: 'Headless Chromium layout and input checks. Physical phone chrome was not tested.' };
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const nav = page.getByRole('navigation', { name: 'On this page', exact: true });
  const pane = page.locator('.doc-content').locator('xpath=ancestor::div[contains(@class,"overflow-y-auto")][1]');
  async function checkPanel() {
    const state = await nav.evaluate(nav => {
      const viewport = nav.lastElementChild;
      const active = nav.querySelector('[aria-current="location"]');
      const n = nav.getBoundingClientRect(), v = viewport.getBoundingClientRect(), a = active?.getBoundingClientRect();
      return { active: active?.textContent, navTop: n.top, navBottom: n.bottom, height: innerHeight, position: getComputedStyle(nav).position, userScrollAreas: [nav, ...nav.querySelectorAll('*')].filter(e => ['auto','scroll'].includes(getComputedStyle(e).overflowY)).length, activeVisible: !!a && a.top >= v.top - 1 && a.bottom <= v.bottom + 1, listTop: viewport.scrollTop };
    });
    if (state.position !== 'sticky' || state.navTop < 0 || state.navBottom > state.height + 1 || !state.activeVisible || state.userScrollAreas) throw Error('Panel lost position ' + JSON.stringify(state));
    return state;
  }
  try {
    await preferences({ ...saved, language: 'en' });
    await page.goto(app + '/docs/test-catalog');
    await expect(page.locator('.doc-content h1')).toHaveText('Test catalog');
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      const state = { width, height, tasks: await page.locator('.doc-content h2').count() };
      const allTasks = page.getByRole('button', { name: 'On this page', exact: true });
      await expect(allTasks).toBeVisible();
      if (width >= 1280) {
        await expect(nav).toBeVisible();
        await expect.poll(() => nav.evaluate(e => getComputedStyle(e).position)).toBe('sticky');
        await expect.poll(async () => (await checkPanel()).activeVisible).toBe(true);
        const headings = page.locator('.doc-content h2');
        state.positions = [];
        for (const index of [1, 8, 12, 4]) {
          const heading = headings.nth(index); const id = await heading.getAttribute('id');
          await heading.evaluate(e => e.scrollIntoView({ block: 'start' }));
          await expect(nav.locator('[aria-current="location"]')).toHaveAttribute('href', '#' + id);
          await expect.poll(async () => (await checkPanel()).activeVisible).toBe(true);
          state.positions.push(await checkPanel());
        }
        const before = await pane.evaluate(e => e.scrollTop);
        const bounds = await nav.boundingBox();
        await page.mouse.move(bounds.x + 100, bounds.y + 50); await page.mouse.wheel(0, 120);
        await expect.poll(() => pane.evaluate(e => e.scrollTop)).toBeGreaterThan(before);
        state.wheelMovesArticle = true;
        await checkPanel();
        // A far-away link must become visible when keyboard focus reaches it.
        const last = nav.getByRole('link').last();
        await last.evaluate(e => e.focus());
        await expect.poll(() => last.evaluate(e => { const r = e.getBoundingClientRect(), v = e.parentElement.getBoundingClientRect(); return r.top >= v.top - 1 && r.bottom <= v.bottom + 1; })).toBe(true);
        await last.press('Enter');
        await expect(nav.locator('[aria-current="location"]')).toHaveAttribute('href', await last.getAttribute('href'));
        await checkPanel();
      } else await expect(nav).not.toBeVisible();
      await allTasks.click();
      const items = page.getByRole('menuitem'); await expect(items).toHaveCount(state.tasks);
      await items.first().press('End');
      await expect(items.last()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('menu')).not.toBeVisible();
      await expect(page.locator('.doc-content h2').last()).toBeInViewport();
      state.fullMenuJump = true;
      state.horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (state.horizontalOverflow) throw Error('Horizontal page overflow');
      if (width >= 1280) await checkPanel();
      await page.screenshot({ path: path.join(__dirname, 'contents-' + width + 'x' + height + '.png') });
      proof.sizes.push(state);
      console.log('PASS ' + width + 'x' + height);
    }
    for (const locale of ['fr', 'pt']) {
      await preferences({ ...saved, language: locale }); await page.setViewportSize({ width: 1440, height: 350 });
      await page.goto(app + '/docs/test-catalog');
      const title = fs.readFileSync(path.resolve(__dirname, '../../../../apps/studio/src/docs/0.1.8', locale, 'test-catalog.md'), 'utf8').match(/^# (.+)$/m)[1];
      await expect(page.locator('.doc-content h1')).toHaveText(title);
      const heading = page.locator('.doc-content h2').nth(12); const id = await heading.getAttribute('id');
      await heading.evaluate(e => e.scrollIntoView({ block: 'start' }));
      await expect(nav.locator('[aria-current="location"]')).toHaveAttribute('href', '#' + id);
      proof.locales.push({ locale, ...await checkPanel() });
      await page.screenshot({ path: path.join(__dirname, 'contents-' + locale + '-1440x350.png') });
    }
    if (errors.length) throw Error('Browser errors ' + errors.join('; '));
    proof.browserErrors = errors;
    fs.writeFileSync(path.join(__dirname, 'browser-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('PINNED CONTENTS PASS: 9 window sizes; active task visible in both scroll directions; wheel scrolls article; full task menu and keyboard navigation; en/fr/pt');
  } catch (error) {
    await page.screenshot({ path: path.join(__dirname, 'failure.png') });
    console.error(await page.evaluate(() => ({ viewport: [innerWidth, innerHeight], active: document.querySelector('[aria-current="location"]')?.getAttribute('href'), focused: document.activeElement?.outerHTML.slice(0, 400), lastHeadingTop: document.querySelector('.doc-content h2:last-of-type')?.getBoundingClientRect().top, scrollTop: document.querySelector('.doc-content')?.closest('.overflow-y-auto')?.scrollTop })));
    throw error;
  } finally { await preferences(saved); await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
