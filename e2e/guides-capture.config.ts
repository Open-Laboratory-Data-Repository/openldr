import { defineConfig } from '@playwright/test';
import { BASE_URL } from './support/config';

// Captures the screenshots and clips for the long how-to guides (docs/<slug>.md).
// Run it against a running server that has the docs sample data loaded. See
// e2e/capture-guides/README.md. It does not start a server and has no global setup, because
// the guides describe a fresh install, not the e2e fixtures.
export default defineConfig({
  testDir: './capture-guides',
  testMatch: '*.guide.ts',
  outputDir: 'artifacts/guides-results',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    // Same flag as playwright.config.ts: the PDF viewer needs it on Chromium 143.
    // CHROMIUM_PATH lets a machine use a Chromium it already has instead of downloading the one
    // this Playwright version pins.
    launchOptions: {
      args: ['--js-flags=--harmony'],
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    },
    serviceWorkers: 'block',
    actionTimeout: 10_000,
  },
});
