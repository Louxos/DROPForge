/**
 * Build configuration for the web application (and the PWA).
 *
 * Constraints that come from the product's rules:
 *  - no external asset: no CDN, no web font, no analytics script is loaded;
 *  - the workspace packages are TypeScript sources, so they are aliased here
 *    instead of being pre-built (the same aliases as the root tsconfig);
 *  - the dev server listens on 0.0.0.0 so it can be reached from another device on
 *    the local network — that is how a phone is used to test a transfer;
 *  - the signaling service is proxied on the same origin (`/ws`), so the browser
 *    never needs a second origin and no CORS rule has to be relaxed.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The workspace packages the application consumes, as TypeScript sources. */
const WORKSPACE_PACKAGES = [
  'app-core',
  'connection-manager',
  'design-system',
  'device-manager',
  'history',
  'notifications',
  'protocol',
  'security',
  'settings',
  'sharing',
  'transfer-engine',
] as const;

/** Where the local signaling service listens during development. */
const SIGNALING_ORIGIN = process.env['DROPFORGE_SIGNALING_ORIGIN'] ?? 'http://127.0.0.1:8787';

/**
 * Base path the application is served from.
 *
 * `/` for a domain root or a local build; `/DROPForge/` for a GitHub Pages project
 * site. Everything the manifest refers to is written relative to it, so an
 * installed application keeps working whatever the path.
 */
const BASE = process.env['DROPFORGE_BASE'] ?? '/';

export default defineConfig({
  root: fromHere('.'),
  base: BASE,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // The update is applied only when the user asks for it; automatic activation
      // would reload the page in the middle of a transfer.
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Navigating while offline serves the application shell; the app then says
        // that only local-network transfers can work.
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: 'DropForge',
        short_name: 'DropForge',
        description:
          'Transférer des fichiers entre vos appareils, chiffrés de bout en bout, sans compte.',
        lang: 'fr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        background_color: '#0b0b0f',
        theme_color: '#0b0b0f',
        categories: ['utilities', 'productivity'],
        icons: [
          { src: `${BASE}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${BASE}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Transfert', url: `${BASE}#route=transfer` },
          { name: 'Historique', url: `${BASE}#route=activity` },
        ],
      },
      devOptions: {
        // The service worker is active in development too, so "install the app" and
        // the update button can be tested for real instead of only in a build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  resolve: {
    // Exact matches plus sub-paths (the design system also ships a stylesheet):
    // a prefix alias would rewrite `@dropforge/design-system/styles.css` into
    // `.../index.ts/styles.css`, which cannot be loaded.
    alias: [
      ...WORKSPACE_PACKAGES.flatMap((name) => [
        { find: new RegExp(`^@dropforge/${name}$`), replacement: fromHere(`../../packages/${name}/src/index.ts`) },
        { find: new RegExp(`^@dropforge/${name}/(.*)$`), replacement: fromHere(`../../packages/${name}/src/$1`) },
      ]),
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // The preview host is served through a reverse proxy: the dev server must not
    // reject the forwarded Host header, and WebSocket upgrades must work.
    allowedHosts: true,
    proxy: {
      '/ws': { target: SIGNALING_ORIGIN, ws: true, changeOrigin: true },
      '/api': { target: SIGNALING_ORIGIN, changeOrigin: true },
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/ws': { target: SIGNALING_ORIGIN, ws: true, changeOrigin: true },
    },
  },
  build: {
    // The application is meant to run offline from a cold start, so it is served as
    // one bundle rather than split into lazy chunks the user would have to fetch.
    chunkSizeWarningLimit: 800,
    // The version is compiled in so "À propos" shows the real one, never a guess.
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env['DROPFORGE_VERSION'] ?? '0.1.0'),
    },
    target: 'es2022',
    sourcemap: true,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
