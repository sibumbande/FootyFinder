import { defineConfig, devices } from '@playwright/test';

// The servers the tests use. Override (E2E_API_URL, E2E_WEB_URL, E2E_ADMIN_URL) to run specs against servers
// already started on other ports; the specs that call the API directly from the page use the defaults.
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';
const ADMIN = process.env.E2E_ADMIN_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      // The whole suite signs up and logs in more than the production limit of 20 auth requests per
      // IP per 15 minutes allows from one machine; the browser-test API alone gets more headroom.
      command: 'npx cross-env NODE_ENV=test RATE_LIMIT_AUTH_PER_15_MINUTES=200 npm run dev:api',
      url: `${API}/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'npm run build:packages && npm run dev --workspace=@footy-finder/web -- --host 127.0.0.1',
      url: WEB,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // CEO touch-up batch 3.5, item 3: the admin app, for e2e/admin.spec.ts.
      command: 'npm run dev --workspace=@footy-finder/admin -- --host 127.0.0.1',
      url: ADMIN,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
