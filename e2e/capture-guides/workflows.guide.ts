// Screenshots and clips for the Workflows guide and the Activity guide
// (apps/studio/src/docs/0.1.8/<locale>/workflows.md and activity.md).
//
// One script for both, because the Activity pictures need the record this script sends through
// the Ingest webhook, and only this script knows the new secret: a saved secret is write-only.
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// It replaces the Ingest webhook secret on the server it runs against, so run it on a test
// install only. The record it sends is sample patient sample-pat-0001, unchanged, so every
// count in the other guides stays the same. It deletes the workflow it builds.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { click, clip, open, point, prepareGuidePage, settle, shot, type, VIEWPORT } from './kit';

const BUILT = 'Orders by test';

async function removeBuilt(api: APIRequestContext): Promise<void> {
  const list = (await (await api.get('/api/workflows')).json()) as Array<{ id: string; name: string }>;
  for (const w of list) if (w.name === BUILT) await api.delete(`/api/workflows/${w.id}`);
}

test.beforeAll(async ({ request }) => removeBuilt(request));
test.afterAll(async ({ request }) => removeBuilt(request));

/** The one sample patient, exactly as the sample file has it, wrapped in a transaction Bundle. */
function samplePatientBundle(): unknown {
  const path = fileURLToPath(new URL('../../apps/web/public/docs-samples/openldr-sample-lab-data.json', import.meta.url));
  const bundle = JSON.parse(readFileSync(path, 'utf8')) as { entry: Array<{ resource: { id: string } }> };
  const entry = bundle.entry.find((e) => e.resource.id === 'sample-pat-0001');
  if (!entry) throw new Error('sample-pat-0001 is missing from the sample file');
  return { resourceType: 'Bundle', type: 'transaction', entry: [entry] };
}

async function fitView(page: Page): Promise<void> {
  await click(page, page.getByRole('button', { name: 'Fit View' }), 600);
}

/** Open a node's Configure Node panel: select the node, then its gear. */
async function configure(page: Page, label: string): Promise<void> {
  await click(page, page.locator('.react-flow__node').filter({ hasText: label }).first(), 300);
  await click(page, page.locator('svg.lucide-settings').first(), 800);
}

test('workflows and activity guides', async ({ page, request }) => {
  test.setTimeout(420_000);
  await prepareGuidePage(page);
  await open(page, '/studio/workflows');
  await shot(page, 'workflows-tour');

  // --- Example 1: get the Ingest webhook ready --------------------------------------------------
  let secret = '';
  await clip(page, 'workflows-ingest-secret', async () => {
    await click(page, page.getByText('Ingest', { exact: true }).first(), 1500);
    await fitView(page);
    await configure(page, 'Ingest received');
    await click(page, page.getByRole('button', { name: 'Replace secret' }), 600);
    secret = await page.locator('input').evaluateAll((inputs) =>
      (inputs as HTMLInputElement[]).map((i) => i.value).find((v) => /^[0-9a-f-]{32,}$/i.test(v)) ?? '');
    await point(page, page.getByText('X-Webhook-Token', { exact: false }).first());
    await page.waitForTimeout(800);
    await click(page, page.getByRole('button', { name: 'Save', exact: true }), 600);
    // Ingest is a system workflow, so Save asks first.
    await click(page, page.getByRole('button', { name: 'Save anyway' }), 1500);
  });
  expect(secret, 'the new webhook secret').not.toBe('');
  await shot(page, 'workflows-ingest-panel');

  // Send the record, as the guide's curl command does.
  const res = await request.post('/api/workflows/hooks/ingest', {
    headers: { 'X-Webhook-Token': secret, 'Content-Type': 'application/json' },
    data: samplePatientBundle(),
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  await page.waitForTimeout(3000);

  // --- Example 2: read the run history ---------------------------------------------------------
  await clip(page, 'workflows-history', async () => {
    await click(page, page.getByRole('button', { name: 'History' }), 1200);
    const sheet = page.getByRole('dialog').first();
    await expect(sheet.getByText('No runs yet.')).toHaveCount(0);
    await click(page, sheet.getByRole('row').nth(1), 1200);
    await settle(page, 800);
  });
  await shot(page, 'workflows-run-detail', { crop: page.getByRole('dialog').first(), pad: 0 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // --- Activity: the same record ----------------------------------------------------------------
  await open(page, '/studio/activity');
  await shot(page, 'activity-list');
  await clip(page, 'activity-detail', async () => {
    await click(page, page.getByRole('row').nth(1), 1200);
    await settle(page, 800);
  });
  await page.keyboard.press('Escape');

  // --- Example 3: build a workflow --------------------------------------------------------------
  await open(page, '/studio/workflows');
  await clip(page, 'workflows-build', async () => {
    await click(page, page.getByRole('button', { name: 'Workflow actions' }));
    await click(page, page.getByRole('menuitem', { name: 'New' }), 1500);
    await type(page, page.getByRole('textbox', { name: 'Workflow name' }), BUILT);
    const canvas = page.locator('.react-flow__pane').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    await click(page, page.getByRole('button', { name: /^Core/ }), 400);
    await page.getByText('Manual Trigger', { exact: true }).dragTo(canvas, { targetPosition: { x: box.width * 0.2, y: box.height / 2 } });
    await settle(page, 500);
    await click(page, page.getByRole('button', { name: /^Core/ }), 300);
    await click(page, page.getByRole('button', { name: /^Databases/ }), 400);
    await page.getByText('Postgres', { exact: true }).first().dragTo(canvas, { targetPosition: { x: box.width * 0.75, y: box.height / 2 } });
    await settle(page, 500);
    await fitView(page);
    const from = page.locator('.react-flow__node').filter({ hasText: 'Manual Trigger' }).locator('.react-flow__handle.source, .react-flow__handle-right').first();
    const to = page.locator('.react-flow__node').filter({ hasText: 'Postgres' }).locator('.react-flow__handle.target, .react-flow__handle-left').first();
    await point(page, from);
    await page.mouse.down();
    const t = await to.boundingBox();
    if (!t) throw new Error('no target handle');
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 25 });
    await page.mouse.up();
    await settle(page, 500);
    await configure(page, 'Postgres');
    const connector = page.getByRole('combobox').filter({ hasText: /connector|Select/i }).first();
    await click(page, connector, 400);
    await click(page, page.getByRole('option', { name: /Target Warehouse/ }).first(), 500);
    const code = page.locator('.cm-content').last();
    await click(page, code, 150);
    await page.keyboard.insertText('SELECT panel_desc AS test, COUNT(*) AS orders\nFROM lab_requests\nGROUP BY panel_desc\nORDER BY orders DESC');
    await page.waitForTimeout(500);
    await click(page, page.getByRole('button', { name: 'Save', exact: true }), 1200);
    // Run arms the workflow. The trigger then shows a play badge: select it to start.
    await click(page, page.getByRole('button', { name: 'Run', exact: true }), 800);
    const play = page.locator('.react-flow__node').filter({ hasText: 'Manual Trigger' }).locator('svg.lucide-play').first();
    await click(page, play, 2500);
    await settle(page, 1200);
  });
  await configure(page, 'Postgres');
  await click(page, page.locator('button:has-text("Output")').first(), 800);
  await shot(page, 'workflows-build-output');

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio/workflows');
  await shot(page, 'workflows-phone');
  await page.setViewportSize(VIEWPORT);
});
