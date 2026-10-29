import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-http', outputDir: '../.scratch/http-test-results', fullyParallel: false, workers: 1, timeout: 240_000,
  use: { baseURL: 'http://127.0.0.1:8082', ...devices['iPhone 13'], browserName: 'chromium', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node --env-file=../api/.env.test e2e-http/api-server.cjs', url: 'http://127.0.0.1:3101', reuseExistingServer: false, timeout: 60_000 },
    { command: 'node e2e/serve.cjs', url: 'http://127.0.0.1:8082', env: { WEB_PORT: '8082', WEB_EXPORT_DIRECTORY: 'dist-http' }, reuseExistingServer: false, timeout: 30_000 },
  ],
});
