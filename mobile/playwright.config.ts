import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, timeout: 90_000,
  use: { baseURL: 'http://127.0.0.1:8081', ...devices['iPhone 13'], browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node e2e/serve.cjs', url: 'http://127.0.0.1:8081', reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
