import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e-dev',
  outputDir: '../.scratch/dev-test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:8083',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node --env-file=.env.test --import tsx src/server.ts',
      cwd: '../api',
      url: 'http://127.0.0.1:3100/v1/session',
      env: { PORT: '3100', HOST: '127.0.0.1', CORS_ORIGINS: 'http://localhost:8083' },
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: 'node --env-file=.env.test --import tsx tests/dev-http.ts',
      cwd: '../api',
      url: 'http://localhost:8083',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
