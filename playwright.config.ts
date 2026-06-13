import { defineConfig, devices } from '@playwright/test';

// Real-browser smoke for the web console. CI-only: requires a Playwright browser binary
// (npx playwright install chromium), which the offline build sandbox cannot fetch. The jsdom
// suite in tests/e2e/*.jsdom.test.ts is the executable browser-level coverage; this is the
// real-Chromium smoke that runs in CI.
export default defineConfig({
  testDir: 'tests/playwright',
  timeout: 30000,
  webServer: {
    command: 'node --import tsx scripts/serve-web.ts',
    url: 'http://127.0.0.1:8787/api/health',
    reuseExistingServer: true,
    timeout: 30000,
  },
  use: { baseURL: 'http://127.0.0.1:8787', ...devices['Desktop Chrome'] },
});
