// Screenshots and clips for the Audit guide (apps/studio/src/docs/0.1.8/<locale>/audit.md).
//
// Run it after workflows.guide.ts: the example finds the wf-ingest events that script
// leaves when it replaces the Ingest webhook secret. It only reads.
import { test } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot, type } from './kit';

test('audit guide', async ({ page }) => {
  test.setTimeout(180_000);
  await prepareGuidePage(page);
  await open(page, '/studio/audit');
  await shot(page, 'audit-tour');

  await clip(page, 'audit-filter-workflow', async () => {
    await click(page, page.getByRole('button', { name: 'Filter' }), 400);
    await click(page, page.getByRole('button', { name: /Add filter/i }), 400);
    const pop = page.getByRole('dialog').first();
    await choose(page, pop.getByRole('combobox', { name: 'Columns' }), 'Entity ID');
    await choose(page, pop.getByRole('combobox', { name: 'Operator' }), 'Contains');
    await type(page, pop.getByRole('textbox').last(), 'wf-ingest');
    await click(page, pop.getByRole('button', { name: 'Apply' }), 1200);
    await settle(page, 600);
    await click(page, page.getByRole('row').nth(1), 1200);
    await settle(page, 800);
  });
  await shot(page, 'audit-event', { crop: page.getByRole('dialog').first(), pad: 0 });
});
