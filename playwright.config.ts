import { defineConfig } from '@playwright/test';
import { demoStorage } from './tests/demo';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 }, serviceWorkers: 'allow',
    // Tests arbeiten mit den Beispieldaten (eine echte Installation startet leer)
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [demoStorage(), { name: 'budget.catview.v1', value: '{"alltag":"list","fix":"list"}' }] }] }, launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {} },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 }
});
