/**
 * Build configuration for the Windows shell.
 *
 * The interface is the shared package (`@dropforge/web`), so this configuration only
 * has to make the workspace sources resolvable and to keep Tauri happy: a fixed port,
 * no HTTPS, and no external asset of any kind (the application must work offline).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Packages that live under packages/. */
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

export default defineConfig({
  root: fromHere('.'),
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      // The shared interface is an application, not a package: it is aliased to the
      // web app's sources, which is what makes "one interface, two shells" literal.
      { find: /^@dropforge\/web$/, replacement: fromHere('../web/src/index.ts') },
      { find: /^@dropforge\/web\/(.*)$/, replacement: fromHere('../web/src/$1') },
      ...WORKSPACE_PACKAGES.flatMap((name) => [
        { find: new RegExp(`^@dropforge/${name}$`), replacement: fromHere(`../../packages/${name}/src/index.ts`) },
        { find: new RegExp(`^@dropforge/${name}/(.*)$`), replacement: fromHere(`../../packages/${name}/src/$1`) },
      ]),
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: true,
  },
  build: {
    // Un seul bundle : l'application doit démarrer hors ligne, sans requête
    // supplémentaire au premier lancement.
    chunkSizeWarningLimit: 800,
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
