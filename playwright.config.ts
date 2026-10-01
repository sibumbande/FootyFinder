import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      // The whole suite signs up and logs in more than the production limit of 20 auth requests per
      // IP per 15 minutes allows from one machine; the browser-test API alone gets more headroom.
      command: 'npx cross-env NODE_ENV=test RATE_LIMIT_AUTH_PER_15_MINUTES=200 npm run dev:api',
      url: 'http://localhost:3000/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'npm run build:packages && npm run dev --workspace=@footy-finder/web -- --host 127.0.0.1',
      url: 'http://localhost:5173',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
