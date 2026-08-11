import { test, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addCallouts,
  disableAnimations,
  maskLocators,
  preparePage,
  removeCallouts,
  runCaptureSteps,
  waitUntilReady,
} from './capture-helpers';
import { ensureDocsFixtures, type DocsFixtureResult } from './fixtures';
import { loadCaptureManifest, type CaptureManifestShot } from './manifest';
import { BASE_URL } from '../support/config';

// Doc screenshots are COMMITTED into the SPA bundle (unlike e2e/artifacts/, which is
// gitignored). They land beside the versioned markdown so Vite emits them as hashed
// assets and DocMarkdown resolves them by basename.
const OUT = fileURLToPath(new URL('../../apps/studio/src/docs/0.1.0/screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const manifest = await loadCaptureManifest();
let fixtureResult: DocsFixtureResult | null = null;

function resolveRoute(route: string): string {
  if (!route.includes('{formId}')) return route;
  if (!fixtureResult?.formId) throw new Error(`cannot resolve form route before fixtures are ready: ${route}`);
  return route.replaceAll('{formId}', fixtureResult.formId);
}

async function capture(browser: Browser, shot: CaptureManifestShot): Promise<void> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: manifest.viewport,
  });
  const page = await context.newPage();
  try {
    await preparePage(page, shot.theme);
    await page.goto(resolveRoute(shot.route), { waitUntil: 'networkidle' });
    // The studio bundle is ~6 MB, and a cold server can still be sending it when `networkidle`
    // resolves. Every capture route is under /studio, so the AppShell sidebar is the signal that
    // React has mounted. Without this, the first capture step races the boot and fails its own
    // 5s timeout. Tolerated if absent so a route without the shell still captures.
    await page.locator('nav').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => undefined);
    await runCaptureSteps(page, shot.steps);
    await waitUntilReady(page, shot.ready);
    // Steps that change state (entering edit mode, switching tabs) make widgets refetch. Without
    // this the shot can catch a chart mid-load and bake an empty panel into the docs image.
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await disableAnimations(page);
    await addCallouts(page, shot.callouts ?? []);

    const screenshotOptions = {
      path: join(OUT, shot.name),
      mask: maskLocators(page, shot.mask ?? []),
    };
    if (shot.crop) {
      await page.locator(shot.crop).first().screenshot(screenshotOptions);
    } else {
      await page.screenshot({ ...screenshotOptions, fullPage: false });
    }
  } finally {
    await removeCallouts(page).catch(() => undefined);
    await context.close();
  }
}

test.beforeAll(async ({ request }) => {
  fixtureResult = await ensureDocsFixtures(request);
});

for (const shot of manifest.shots) {
  test(`doc-shot ${shot.name}`, async ({ browser }) => {
    await capture(browser, shot);
  });
}
