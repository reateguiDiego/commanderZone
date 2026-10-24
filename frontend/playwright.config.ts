import { defineConfig, devices } from '@playwright/test';

const browserPerf = process.env['BROWSER_PERF'];
if (browserPerf && !['record', 'verify'].includes(browserPerf)) throw new Error('BROWSER_PERF must be record or verify');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: !browserPerf,
  workers: browserPerf ? 1 : undefined,
  testMatch: browserPerf === 'record' ? '**/browser-performance.guided.spec.ts' : browserPerf === 'verify' ? '**/browser-performance.recorder.spec.ts' : undefined,
  forbidOnly: !!process.env['CI'],
  retries: browserPerf ? 0 : process.env['CI'] ? 2 : 0,
  reporter: 'html',
  webServer: browserPerf ? undefined : {
    command: 'npm run start -- --host 127.0.0.1 --port 4200',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
  use: {
    baseURL: browserPerf ? (process.env['BROWSER_PERF_URL'] || 'https://commanderzone.com') : 'http://127.0.0.1:4200',
    headless: browserPerf !== 'record',
    trace: browserPerf ? 'off' : 'retain-on-failure',
    screenshot: browserPerf ? 'off' : 'only-on-failure',
    video: browserPerf ? 'off' : 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
