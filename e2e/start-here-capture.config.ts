import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './capture-start-here',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5180', viewport: { width: 1440, height: 900 }, headless: true, serviceWorkers: 'block' },
  reporter: 'list',
});
