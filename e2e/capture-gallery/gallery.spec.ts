import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  disableAnimations,
  preparePage,
  runCaptureSteps,
  waitUntilReady,
} from '../capture-docs/capture-helpers';
import { ensureDocsFixtures, type DocsFixtureResult } from '../capture-docs/fixtures';
import type { CaptureManifestShot } from '../capture-docs/manifest';
import { BASE_URL } from '../support/config';

// The landing gallery's own captures. Separate from the docs shots on purpose: those carry
// numbered callout badges, which teach a reader a procedure but look like a tutorial when the
// point is to show what the product looks like. Same screens, no annotations.
const OUT = fileURLToPath(new URL('../../apps/web/src/landing/gallery/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

type GalleryShot = Pick<CaptureManifestShot, 'name' | 'route' | 'ready' | 'steps'> & {
  crop?: string;
  /** Panels to leave open, by their collapse button's label. */
  keepPanels?: string[];
};

const SHOTS: GalleryShot[] = [
  {
    name: 'dashboard.png',
    route: '/studio',
    ready: { kind: 'selector', value: '[aria-label="Dashboard"]' },
    steps: [],
  },
  {
    name: 'reports.png',
    route: '/studio/reports',
    ready: { kind: 'text', value: 'Spreadsheet' },
    // A report shows no parameters, and therefore no Run button, until they are opened from the
    // Actions menu. The docs manifest still clicks Run straight after selecting the report, which
    // is why that capture now fails — the UI grew the menu after the manifest was written.
    steps: [
      { action: 'selectText', text: 'AMR Resistance Rate' },
      { action: 'click', role: 'button', name: 'Actions' },
      { action: 'click', role: 'menuitem', name: 'Parameters' },
      { action: 'click', role: 'button', name: 'Run' },
      { action: 'click', role: 'button', name: 'Spreadsheet' },
      { action: 'waitForText', text: 'Spreadsheet' },
    ],
  },
  {
    name: 'query.png',
    route: '/studio/query',
    // "Facilities (options)" on purpose: most of the seeded queries carry {{param.*}} placeholders,
    // and Run on those opens a parameter form instead of executing, leaving the pane on "No
    // results". This one takes no parameters and returns 50 rows, so the shot shows SQL and a grid.
    ready: { kind: 'text', value: 'rows' },
    steps: [
      { action: 'click', role: 'button', name: 'Connectors' },
      { action: 'click', role: 'button', name: 'Custom Queries' },
      { action: 'selectText', text: 'Facilities (options)' },
      { action: 'click', role: 'button', name: 'Run' },
      { action: 'waitForText', text: 'rows' },
    ],
  },
  {
    name: 'form-builder.png',
    route: '/studio/forms/{formId}/builder',
    ready: { kind: 'selector', value: '[aria-label="Builder actions"]' },
    steps: [],
  },
  {
    name: 'terminology.png',
    route: '/studio/terminology',
    ready: { kind: 'text', value: 'LOINC' },
    steps: [],
  },
  {
    name: 'report-designer.png',
    route: '/studio/report-designer/rt-amr-resistance',
    ready: { kind: 'selector', value: '[data-testid="inspector"]' },
    steps: [],
  },
  {
    name: 'workflows.png',
    route: '/studio/workflows/docs-training-workflow',
    ready: { kind: 'selector', value: '.react-flow' },
    // Open the Core group so the palette shows actual nodes. Category headers alone read as an
    // empty menu; the node cards are what say "this is what you can build with".
    steps: [{ action: 'click', role: 'button', name: 'CORE' }],
    // The node library stays open here: the palette is what the screen is for. Collapsed, the shot
    // is three nodes on an empty canvas and says nothing about what can be built.
    keepPanels: ['Collapse node library'],
  },
  {
    name: 'marketplace.png',
    route: '/studio/settings/marketplace',
    ready: { kind: 'selector', value: '[data-testid="marketplace-page"]' },
    steps: [],
  },
];

let fixtureResult: DocsFixtureResult | null = null;

function resolveRoute(route: string): string {
  if (!route.includes('{formId}')) return route;
  if (!fixtureResult?.formId) throw new Error(`cannot resolve form route before fixtures are ready: ${route}`);
  return route.replaceAll('{formId}', fixtureResult.formId);
}

// Panels that eat horizontal space and are not the point of the shot. Each is best-effort: a page
// without one just skips it.
const INNER_PANELS = ['Collapse library', 'Collapse node library', 'Collapse explorer'];

async function capture(browser: Browser, shot: GalleryShot): Promise<void> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await preparePage(page, 'dark');
    // The nav rail is the same on every screen and says nothing about the feature being shown.
    // Collapsed, it gives the content roughly 180px more width. This key is what the shell reads.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('openldr-sidebar-collapsed', 'true');
      } catch {
        // Storage disabled: the shot still works, just with the rail expanded.
      }
    });
    await page.goto(resolveRoute(shot.route), { waitUntil: 'networkidle' });
    // The studio bundle is ~6 MB and can still be arriving when networkidle resolves; the AppShell
    // nav is the signal that React has mounted. Without it the first step races the boot.
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
    await runCaptureSteps(page, shot.steps);
    await waitUntilReady(page, shot.ready);

    for (const label of INNER_PANELS) {
      if (shot.keepPanels?.includes(label)) continue;
      const button = page.getByRole('button', { name: label });
      if ((await button.count()) > 0) await button.first().click({ timeout: 3_000 }).catch(() => undefined);
    }

    await page.waitForLoadState('networkidle').catch(() => undefined);
    await disableAnimations(page);
    // Let the panels finish closing before the shutter; disableAnimations only stops what starts
    // after it is injected.
    await page.waitForTimeout(500);

    const target = shot.crop ? page.locator(shot.crop).first() : page;
    await target.screenshot({ path: join(OUT, shot.name) });
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ request }) => {
  fixtureResult = await ensureDocsFixtures(request);
});

for (const shot of SHOTS) {
  test(`gallery ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
