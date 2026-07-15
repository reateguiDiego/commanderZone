import { defineConfig, devices } from '@playwright/test';

const manualBrowserZoomQa = process.env['E2E_MANUAL_BROWSER_ZOOM'] === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'html',
  webServer: {
    command: 'npm run start -- --host 127.0.0.1 --port 4200',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: manualBrowserZoomQa ? 'off' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: manualBrowserZoomQa ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: manualBrowserZoomQa ? {
          args: [
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ],
        } : undefined,
      },
    },
  ],
});
