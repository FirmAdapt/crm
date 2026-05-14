import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: 'http://dev.localhost:8000',
    storageState: 'tests/e2e/.auth/admin.json',
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
      // The setup project creates the storageState file — it must NOT
      // try to load it first.
      use: { storageState: undefined },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
