import { defineConfig } from '@playwright/test';
import { demoStorage } from './tests/demo';

// Bildvergleich (Referenz = v1.78.5): npm run visual · neue Referenz: npm run visual -- --update-snapshots
export default defineConfig({
  testDir: 'visual',
  timeout: 90_000,
  workers: 1,
  snapshotPathTemplate: '{testDir}/baseline/{arg}{ext}',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
  use: {
    baseURL: 'http://localhost:4173', viewport: { width: 390, height: 844 }, serviceWorkers: 'block',
    locale: 'de-DE', timezoneId: 'Europe/Berlin',
    storageState: { cookies: [], origins: [{ origin: 'http://localhost:4173', localStorage: [demoStorage('2026-11')] }] },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 120_000 }
});
