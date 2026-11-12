// Run only against the disposable review app on ports 3010 and 5190.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const repo = path.resolve(__dirname, '../../../..');
const { chromium, expect } = require(path.join(repo, 'e2e/node_modules/@playwright/test'));
const apiBase = 'http://127.0.0.1:3010';
const studioBase = 'http://127.0.0.1:5190';
const out = __dirname;
const designId = 'd-bugfix-date-range';
const reportId = 'r-bugfix-date-range';
const reportName = 'Fictional date range review';
const uiReportName = 'Fictional UI report review';
const dateValues = { from: '2026-01-01', to: '2026-11-12' };
const expectedRow = { start_date: dateValues.from, end_date: dateValues.to };
const proof = { capturedAt: new Date().toISOString(), apiBase, studioBase, writes: 'Only guide_bugfix_internal, guide_bugfix_target and openldr-docs-bugfix-review', tests: {} };
const manifest = { capturedAt: proof.capturedAt, source: 'Live isolated Studio. Native DPR 4 screenshots.', steps: [] };
function save(name, value) { fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2) + '\n'); }
async function api(route, method = 'GET', body) {
  const res = await fetch(apiBase + '/api' + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw Error(method + ' ' + route + ' HTTP ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : null;
}
async function fixtures() {
  const connector = (await api('/connectors')).find(c => c.name === 'Target Warehouse (Postgres)');
  assert(connector, 'Fresh review warehouse connector is missing');
  const queryInput = { name: reportName + ' query', connectorId: connector.id, sql: 'select {{param.from}}::text as start_date, {{param.to}}::text as end_date', params: [{ id: 'period', label: 'Period', type: 'daterange', required: true }] };
  let query = (await api('/custom-queries')).find(q => q.name === queryInput.name);
  if (query) { await api('/custom-queries/' + query.id, 'PUT', queryInput); }
  else { query = await api('/custom-queries', 'POST', queryInput); }
  const design = { id: designId, name: 'Fictional date range design', status: 'draft', parameters: [{ key: 'period', label: 'Period', type: 'daterange', required: true }], pages: [{ id: 'p-bugfix', elements: [{ id: 'table-bugfix', kind: 'table', name: 'Date values', rect: { x: 20, y: 30, w: 540, h: 110 }, dataSource: { kind: 'custom-query', queryId: query.id }, boundColumns: [{ key: 'start_date', label: 'Start date' }, { key: 'end_date', label: 'End date' }] }] }] };
  const hasDesign = (await api('/report-designs')).some(d => d.id === designId);
  await api('/report-designs' + (hasDesign ? '/' + designId : ''), hasDesign ? 'PUT' : 'POST', design);
  const report = { id: reportId, name: reportName, description: 'Fictional dates only. No clinical rows.', category: 'operational', designId, primaryQueryId: query.id, status: 'published' };
  const hasReport = (await api('/report-defs')).some(r => r.id === reportId);
  await api('/report-defs' + (hasReport ? '/' + reportId : ''), hasReport ? 'PUT' : 'POST', report);
  proof.fixture = { query: await api('/custom-queries/' + query.id), design: await api('/report-designs/' + designId), report: await api('/report-defs/' + reportId) };
  save('report-fixtures.json', proof.fixture);
  console.log('Fixture API writes passed on isolated ports');
  return query.id;
}
async function outputChecks(id, prefix) {
  const search = new URLSearchParams(dateValues);
  const result = await api('/reports/' + id + '?' + search);
  assert.deepEqual(result.rows, [expectedRow]);
  const records = { json: { status: 200, result } };
  for (const suffix of ['csv', 'pdf']) {
    const res = await fetch(apiBase + '/api/reports/' + id + '.' + suffix + '?' + search);
    assert.equal(res.status, 200, suffix + ' response status');
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(out, prefix + '.' + suffix), bytes);
    if (suffix === 'csv') { assert(bytes.toString().includes(dateValues.from)); assert(bytes.toString().includes(dateValues.to)); }
    else assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    records[suffix] = { status: res.status, contentType: res.headers.get('content-type'), bytes: bytes.length };
  }
  return records;
}
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await fixtures();
  if (process.argv.includes('--fixtures-only')) return;
  proof.tests.apiDateRange = await outputChecks(reportId, 'date-range-api');
  await api('/me/preferences', 'PUT', { language: 'en', theme: 'dark', sidebarCollapsed: false });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/home/fredrick/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 4 });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const button = name => page.getByRole('button', { name, exact: true });
  const menu = name => page.getByRole('menuitem', { name, exact: true });
  async function shot(id, caption, targets) {
    await page.evaluate(() => document.fonts.ready);
    const focus = [];
    for (const target of targets) { await target.scrollIntoViewIfNeeded(); const box = await target.boundingBox(); assert(box); focus.push(box); }
    const viewport = page.viewportSize();
    await page.screenshot({ path: path.join(out, id + '.png'), animations: 'disabled' });
    manifest.steps.push({ id, caption, path: 'bugfix-evidence/' + id + '.png', source_dimensions: [viewport.width, viewport.height], pixel_dimensions: [viewport.width * 4, viewport.height * 4], focus });
    save('report-capture-manifest.json', manifest);
  }
  async function selectReport(name) {
    await page.goto(studioBase + '/studio/reports');
    await page.getByPlaceholder('Search reports…').fill(name);
    await page.getByText(name, { exact: true }).first().click();
    await button('Actions').waitFor();
  }
  try {
    // Create through the actual sheet, whose request omits optional metadata.
    const prior = (await api('/report-defs')).find(r => r.name === uiReportName);
    if (prior) await api('/report-defs/' + prior.id, 'DELETE');
    await page.goto(studioBase + '/studio/report-designer/' + designId);
    await button('More actions').click();
    await menu('Create report from this design').click();
    const sheet = page.getByRole('dialog').last();
    await page.getByLabel('Name', { exact: true }).fill(uiReportName);
    await expect(page.getByLabel('Template', { exact: true })).toContainText('Fictional date range design');
    await expect(page.getByLabel('Primary query', { exact: true })).toContainText(reportName + ' query');
    await sheet.getByRole('button', { name: 'Actions', exact: true }).click();
    const [createdResponse] = await Promise.all([page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/report-defs'), menu('Create report').click()]);
    assert.equal(createdResponse.status(), 201);
    const created = await createdResponse.json();
    for (const key of ['summaryMetrics', 'chart', 'paramOptions']) assert.equal(created[key], null);
    assert.equal(created.status, 'published');
    proof.tests.uiCreate = { status: createdResponse.status(), request: createdResponse.request().postDataJSON(), record: created };
    await selectReport(uiReportName);
    await button('Actions').click();
    await shot('reports-unpublish-action', 'Select Unpublish for the selected report.', [menu('Unpublish')]);
    const [unpublishResponse] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/report-defs/' + created.id), menu('Unpublish').click()]);
    assert.equal(unpublishResponse.status(), 200);
    const draft = await api('/report-defs/' + created.id);
    assert.equal(draft.status, 'draft');
    const success = page.getByText('Report unpublished', { exact: true }).first();
    await success.waitFor();
    await expect(page.getByText(uiReportName, { exact: true })).toHaveCount(0);
    await shot('reports-unpublish-success', 'Unpublish succeeds. The report leaves the library. The API records Draft and retains its design.', [success, page.getByPlaceholder('Search reports…')]);
    proof.tests.uiUnpublish = { status: unpublishResponse.status(), request: unpublishResponse.request().postDataJSON(), response: await unpublishResponse.json(), persisted: draft, libraryEntryRemoved: true, designRetained: Boolean(await api('/report-designs/' + designId)) };
    // No republish control exists for a removed draft. Exercise the existing runtime helper.
    const [publishResponse] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/report-defs/' + created.id), page.evaluate(async id => { const { setReportStatus } = await import('/studio/src/reports/reportDefsApi.ts'); await setReportStatus(id, 'published'); }, created.id)]);
    assert.equal(publishResponse.status(), 200);
    proof.tests.helperRepublish = { method: 'Existing browser setReportStatus helper, not a visible UI control', status: publishResponse.status(), request: publishResponse.request().postDataJSON(), record: await api('/report-defs/' + created.id) };
    await selectReport(uiReportName);
    await button('Actions').click();
    await menu('Parameters').click();
    const parameters = page.getByRole('dialog').last();
    await button('Period').click();
    await button('This year').click();
    await shot('reports-date-range-parameters', 'The required Period filter accepts a Date range preset.', [parameters.getByRole('button', { name: 'Run', exact: true })]);
    const [runResponse] = await Promise.all([page.waitForResponse(r => r.request().method() === 'GET' && new URL(r.url()).pathname === '/api/reports/' + created.id), parameters.getByRole('button', { name: 'Run', exact: true }).click()]);
    assert.equal(runResponse.status(), 200);
    const run = await runResponse.json();
    const runUrl = new URL(runResponse.url());
    assert.deepEqual(run.rows, [{ start_date: runUrl.searchParams.get('from'), end_date: runUrl.searchParams.get('to') }]);
    await button('Spreadsheet').click();
    await page.getByRole('cell', { name: run.rows[0].start_date, exact: true }).waitFor();
    await shot('reports-date-range-result', 'The required Date range query returns the dates selected in Reports.', [page.getByRole('cell', { name: run.rows[0].start_date, exact: true }), page.getByRole('cell', { name: run.rows[0].end_date, exact: true })]);
    proof.tests.uiDateRange = { status: runResponse.status(), query: Object.fromEntries(runUrl.searchParams), result: run };
    proof.tests.uiReportExports = await outputChecks(created.id, 'date-range-ui-report');
    await button('Actions').click();
    const [finalUnpublish] = await Promise.all([page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/report-defs/' + created.id), menu('Unpublish').click()]);
    assert.equal(finalUnpublish.status(), 200);
    proof.tests.finalDraft = await api('/report-defs/' + created.id);
    assert.equal(proof.tests.finalDraft.status, 'draft');
    proof.browserErrors = errors;
    assert.deepEqual(errors, []);
    save('report-live-proof.json', proof);
    console.log('PASS UI create 201, Unpublish 200, helper Publish 200, Date range run 200, JSON/CSV/PDF 200, final Draft');
  } catch (error) {
    save('report-live-partial.json', proof);
    fs.writeFileSync(path.join(out, 'report-failure.txt'), await page.locator('body').innerText());
    await page.screenshot({ path: path.join(out, 'report-failure.png') });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
