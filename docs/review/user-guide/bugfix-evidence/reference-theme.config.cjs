const path = require('node:path');
module.exports = {
  testDir: path.resolve(__dirname, '../../../../e2e/tests'),
  testMatch: 'plugin-ui-theme.spec.ts',
  outputDir: path.join(require('node:os').tmpdir(), 'openldr-reference-theme-results'),
  reporter: 'list',
  workers: 1,
  use: {
    browserName: 'chromium',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
};
