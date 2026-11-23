import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  workers: 1,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    // Use the hardware GPU like a real browser (the default headless software renderer runs WebGL at ~2 fps).
    launchOptions: { args: ['--use-angle=default'] },
  },
  webServer: [
    {
      command: 'cd ../backend && .venv/Scripts/python -m uvicorn app.main:app --port 8000',
      url: 'http://localhost:8000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
