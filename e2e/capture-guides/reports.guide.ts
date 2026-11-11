// Screenshots and clips for the Reports guide (apps/studio/src/docs/0.1.8/<locale>/reports.md).
//
// Needs a fresh install with the docs sample data loaded (see README.md beside this file).
// Afterwards it deletes the schedules it made.
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { choose, click, clip, open, prepareGuidePage, settle, shot } from './kit';

const REPORT = 'r-test-volume';

async function removeSchedules(api: APIRequestContext): Promise<void> {
  const res = await api.get(`/api/reports/${REPORT}/schedules`);
  if (!res.ok()) return;
  const { schedules } = (await res.json()) as { schedules: Array<{ id: string }> };
  for (const s of schedules) await api.delete(`/api/reports/schedules/${s.id}`);
}

test.beforeAll(async ({ request }) => removeSchedules(request));
test.afterAll(async ({ request }) => removeSchedules(request));

async function reportActions(page: Page, item: string): Promise<void> {
  await click(page, page.locator('main').getByRole('button', { name: 'Actions' }).first());
  await click(page, page.getByRole('menuitem', { name: item, exact: true }));
}

/** Pick 1 September to 31 October 2026 in a date range picker. */
async function pickSepOct(page: Page, trigger: Locator): Promise<void> {
  await click(page, trigger, 400);
  const previous = page.getByRole('button', { name: /previous month/i }).first();
  for (let i = 0; i < 12 && !(await page.getByRole('button', { name: /September 1st, 2026/ }).first().isVisible()); i++) {
    await click(page, previous, 150);
  }
  await click(page, page.getByRole('button', { name: /September 1st, 2026/ }).first(), 300);
  await click(page, page.getByRole('button', { name: /October 31st, 2026/ }).first(), 300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

async function runReport(page: Page, name: string): Promise<void> {
  await click(page, page.getByText(name, { exact: true }).first(), 600);
  await reportActions(page, 'Parameters');
  const sheet = page.getByRole('dialog').first();
  await pickSepOct(page, sheet.getByRole('button', { name: /Date range|2026/ }).first());
  await click(page, sheet.getByRole('button', { name: 'Run' }), 300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await settle(page, 1500);
}

test('reports guide', async ({ page }) => {
  test.setTimeout(300_000);
  await prepareGuidePage(page);
  await open(page, '/studio/reports');

  // --- Example 1: run a report -----------------------------------------------------------------
  await clip(page, 'reports-run', async () => {
    await runReport(page, 'Test Volume Over Time');
  });
  await shot(page, 'reports-tour', {
    callouts: [
      { number: 1, selector: 'input[placeholder="Search reports…"]', offsetX: -6, offsetY: -14 },
      { number: 2, selector: 'main button[aria-label="Actions"]', offsetX: -14, offsetY: 30 },
      { number: 3, selector: 'main button:has-text("Document")', offsetX: -6, offsetY: -14 },
      { number: 4, selector: 'main button:has-text("Spreadsheet")', offsetX: -6, offsetY: -14 },
      { number: 5, selector: 'main button:has-text("Download")', offsetX: -60, offsetY: 30 },
    ],
  });

  // --- Example 2: the spreadsheet --------------------------------------------------------------
  await click(page, page.getByRole('button', { name: 'Spreadsheet' }), 800);
  await shot(page, 'reports-spreadsheet');

  // --- Run history ------------------------------------------------------------------------------
  await reportActions(page, 'Run History');
  await settle(page, 600);
  await shot(page, 'reports-history', { crop: page.getByRole('dialog').first(), pad: 0 });
  await page.keyboard.press('Escape');
  await settle(page, 300);

  // --- Example 3: turnaround time ---------------------------------------------------------------
  await runReport(page, 'Specimen Turnaround Time');
  await shot(page, 'reports-turnaround');

  // --- Example 4: a weekly schedule -------------------------------------------------------------
  await click(page, page.getByText('Test Volume Over Time', { exact: true }).first(), 600);
  await clip(page, 'reports-schedule', async () => {
    await reportActions(page, 'Schedules');
    await click(page, page.getByRole('button', { name: 'New Schedule' }), 600);
    const form = page.getByRole('dialog').last();
    await choose(page, form.getByRole('combobox', { name: 'Frequency' }), 'Weekly');
    await settle(page, 300);
    const weekday = form.getByRole('combobox', { name: /Weekday|Day of week/ });
    if (await weekday.count()) await choose(page, weekday.first(), 'Mon');
    await choose(page, form.getByRole('combobox', { name: 'Output format' }), 'PDF');
    await click(page, form.getByRole('button', { name: 'Actions' }));
    await click(page, page.getByRole('menuitem', { name: 'Save' }), 900);
    await settle(page, 800);
  });
  await shot(page, 'reports-schedules', { crop: page.getByRole('dialog').first(), pad: 0 });
  await page.keyboard.press('Escape');

  // --- On a phone -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, '/studio/reports');
  // On a phone the library starts folded. Open it, as the guide tells readers to.
  await click(page, page.getByRole('button', { name: /Expand library/i }).first(), 600);
  await shot(page, 'reports-phone');
});
