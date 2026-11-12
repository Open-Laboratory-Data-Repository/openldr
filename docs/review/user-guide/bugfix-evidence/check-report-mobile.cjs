const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../../..');
const { chromium, expect } = require(path.join(repo, 'e2e/node_modules/@playwright/test'));
const apiBase = 'http://127.0.0.1:3010/api';
const studioBase = 'http://127.0.0.1:5190/studio';
const reportId = 'r-bugfix-date-range-phone';
const name = 'Fictional phone report review';
async function api(route, method = 'GET', body) {
  const res = await fetch(apiBase + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  assert(res.ok, route + ' HTTP ' + res.status);
  return res.json();
}
(async () => {
  const base = await api('/report-defs/r-bugfix-date-range');
  const report = { ...base, id: reportId, name, status: 'published' };
  const existing = (await api('/report-defs')).some(r => r.id === reportId);
  await api('/report-defs' + (existing ? '/' + reportId : ''), existing ? 'PUT' : 'POST', report);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 4 });
  page.setDefaultTimeout(15000);
  const button = label => page.getByRole('button', { name: label, exact: true });
  const menu = label => page.getByRole('menuitem', { name: label, exact: true });
  const proof = { viewport: [375, 812], pixelDimensions: [1500, 3248], limit: 'Headless Chromium proves layout and requests. Real phone browser chrome remains unproved.', steps: [] };
  async function shot(id, target) {
    await page.evaluate(() => document.fonts.ready);
    const focus = await target.boundingBox();
    assert(focus);
    await page.screenshot({ path: path.join(__dirname, id + '.png'), animations: 'disabled' });
    proof.steps.push({ id, focus });
  }
  try {
    await page.goto(studioBase + '/reports');
    await button('Expand library').or(button('Collapse library')).waitFor();
    if (await button('Expand library').isVisible()) await button('Expand library').click();
    await page.getByPlaceholder('Search reports…').fill(name);
    await page.getByText(name, { exact: true }).first().click();
    await button('Collapse library').click();
    await button('Actions').click();
    await menu('Parameters').click();
    const parameters = page.getByRole('dialog').last();
    await expect(parameters.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await button('Period').click();
    await button('This year').click();
    await expect(parameters.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await shot('reports-phone-date-range', parameters.getByRole('button', { name: 'Run', exact: true }));
    const [response] = await Promise.all([page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/reports/' + reportId), parameters.getByRole('button', { name: 'Run', exact: true }).click()]);
    assert.equal(response.status(), 200);
    const result = await response.json();
    const search = new URL(response.url()).searchParams;
    assert.deepEqual(result.rows, [{ start_date: search.get('from'), end_date: search.get('to') }]);
    await button('Spreadsheet').click();
    const first = page.getByRole('cell', { name: result.rows[0].start_date, exact: true });
    await first.waitFor();
    await shot('reports-phone-date-result', first);
    proof.run = { status: response.status(), query: Object.fromEntries(search), result };
    proof.layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight }));
    assert.equal(proof.layout.documentWidth, 375);
    await button('Actions').click();
    const [unpublish] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/report-defs/' + reportId), menu('Unpublish').click()]);
    assert.equal(unpublish.status(), 200);
    const success = page.getByText('Report unpublished', { exact: true }).first();
    await success.waitFor();
    await shot('reports-phone-unpublish-success', success);
    proof.unpublish = { status: unpublish.status(), request: unpublish.request().postDataJSON(), persisted: await api('/report-defs/' + reportId) };
    assert.equal(proof.unpublish.persisted.status, 'draft');
    fs.writeFileSync(path.join(__dirname, 'report-mobile-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log('PASS mobile 375x812 required Date range run 200, Unpublish 200, persisted Draft, no document overflow');
  } catch (error) {
    fs.writeFileSync(path.join(__dirname, 'report-mobile-failure.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: path.join(__dirname, 'report-mobile-failure.png') });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
