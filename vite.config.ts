import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base './' damit die App unter jeder Adresse läuft (z. B. https://name.github.io/budget/).
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 'prompt': Updates werden erst nach Bestätigung aktiv. Finanzdaten liegen in IndexedDB
      // und nicht im Cache, ein Update berührt sie nicht.
      registerType: 'prompt',
      // Registrierung erfolgt selbst in src/pwa.ts (updateViaCache: 'none', robustes Aktualisieren)
      injectRegister: false,
      includeAssets: ['icon-180.png'],
      manifest: {
        name: 'Budget',
        short_name: 'Budget',
        description: 'Mein privates Monatsbudget – alle Daten bleiben auf dem Gerät.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts']
  }
});
