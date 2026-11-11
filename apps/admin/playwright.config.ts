import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: process.env.ADMIN_URL ?? 'http://localhost:3000', viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  reporter: [['list']],
});
