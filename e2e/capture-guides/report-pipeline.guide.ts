// Screenshots and clips for the Scheduled reports guide (apps/studio/src/docs/0.1.8/<locale>/report-pipeline.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// It builds a workflow that materializes a dataset from the sample, and deletes the workflow at
// the end. The dataset it wrote stays, under the name `orders_by_test_sample`.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { click, clip, open, point, prepareGuidePage, settle, shot, type } from './kit';

const BUILT = 'Materialize orders by test (sample)';
const DATASET = 'orders_by_test_sample';
const SQL = [
  'SELECT panel_desc AS test, COUNT(*) AS orders',
  'FROM lab_requests',
  "WHERE authored_at >= '2026-09-01' AND authored_at < '2026-11-01'",
  'GROUP BY panel_desc',
  'ORDER BY orders DESC',
].join('\n');

async function removeBuilt(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/workflows')).json()) as Array<{ id: string; name: string }>;
  for (const w of list) if (w.name === BUILT) await api.delete(`/api/workflows/${w.id}`);
}

test.beforeAll(async ({ request }) => removeBuilt(request));
test.afterAll(async ({ request }) => removeBuilt(request));

const node = (page: Page, label: string): Locator => page.locator('.react-flow__node').filter({ hasText: label }).first();

async function configure(page: Page, label: string): Promise<void> {
  await click(page, node(page, label), 300);
  await click(page, page.locator('svg.lucide-settings').first(), 800);
}

async function drop(page: Page, category: RegExp, name: string, x: number, y = 0.5): Promise<void> {
  const canvas = page.locator('.react-flow__pane').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await click(page, page.getByRole('button', { name: category }), 400);
  await page.getByText(name, { exact: true }).first().dragTo(canvas, { targetPosition: { x: box.width * x, y: box.height * y } });
  await settle(page, 400);
  await click(page, page.getByRole('button', { name: category }), 300);
}

async function wire(page: Page, fromLabel: string, toLabel: string): Promise<void> {
  const from = node(page, fromLabel).locator('.react-flow__handle.source, .react-flow__handle-right').first();
  const to = node(page, toLabel).locator('.react-flow__handle.target, .react-flow__handle-left').first();
  await point(page, from);
  await page.mouse.down();
  const t = await to.boundingBox();
  if (!t) throw new Error(`no target handle on ${toLabel}`);
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 25 });
  await page.mouse.up();
  await settle(page, 400);
}

test('report pipeline guide', async ({ page }) => {
  test.setTimeout(400_000);
  await prepareGuidePage(page);
  await open(page, '/studio/workflows');

  await clip(page, 'report-pipeline-build', async () => {
    await click(page, page.getByRole('button', { name: 'Workflow actions' }));
    await click(page, page.getByRole('menuitem', { name: 'New' }), 1500);
    await type(page, page.getByRole('textbox', { name: 'Workflow name' }), BUILT);
    await drop(page, /^Core/, 'Manual Trigger', 0.08, 0.3);
    await drop(page, /^Databases/, 'Postgres', 0.5, 0.55);
    await drop(page, /^Core/, 'Materialize Dataset', 0.9, 0.3);
    await click(page, page.getByRole('button', { name: 'Fit View' }), 600);
    await wire(page, 'Manual Trigger', 'Postgres');
    await wire(page, 'Postgres', 'Materialize Dataset');
    await configure(page, 'Postgres');
    await click(page, page.getByRole('combobox').filter({ hasText: /connector|Select/i }).first(), 400);
    await click(page, page.getByRole('option', { name: /Target Warehouse/ }).first(), 500);
    await click(page, page.locator('.cm-content').last(), 150);
    await page.keyboard.insertText(SQL);
    await settle(page, 500);
    await page.keyboard.press('Escape');
    await configure(page, 'Materialize Dataset');
    await settle(page, 600);
  });
  await clip(page, 'report-pipeline-run', async () => {
    await type(page, page.getByPlaceholder('amr-results'), DATASET);
    await page.keyboard.press('Escape');
    await click(page, page.getByRole('button', { name: 'Save', exact: true }), 1200);
    await click(page, page.getByRole('button', { name: 'Run', exact: true }), 800);
    await click(page, node(page, 'Manual Trigger').locator('svg.lucide-play').first(), 3000);
    await settle(page, 1500);
  });
  await configure(page, 'Materialize Dataset');
  await click(page, page.locator('button:has-text("Output")').first(), 800);
  await shot(page, 'report-pipeline-output');
  await page.keyboard.press('Escape');
  await click(page, page.getByRole('button', { name: 'Datasets', exact: true }), 1200);
  console.log('DATASETS', await page.getByRole('dialog').first().innerText().catch(() => 'no dialog'));
  await shot(page, 'report-pipeline-datasets');
  await page.keyboard.press('Escape');

  // The dataset from Query.
  await open(page, '/studio/query');
  if (await page.getByRole('button', { name: /Expand explorer/i }).count()) {
    await click(page, page.getByRole('button', { name: /Expand explorer/i }).first(), 600);
  }
  await clip(page, 'report-pipeline-query', async () => {
    await click(page, page.getByRole('button', { name: 'Datasets', exact: true }), 800);
    await click(page, page.getByRole('button', { name: DATASET, exact: true }).or(page.getByText(DATASET, { exact: true })).first(), 2000);
    await settle(page, 1200);
  });
  await shot(page, 'report-pipeline-query-result');
  void expect;
});
