import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'packages/*/src/**/*.test.tsx',
            // The web app's logic (controller, capability detection, i18n) is unit
            // tested without a DOM; its rendering is exercised by the dev server.
            'apps/web/src/**/*.test.ts',
            'apps/web/src/**/*.test.tsx',
            // The desktop shell's pure helpers (path handling) run here too. Tests
            // that need the Tauri runtime cannot live in this project: only files
            // that import nothing from `@tauri-apps/*` may be added.
            'apps/desktop/src/**/*.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/**/*.test.ts', 'apps/signaling/src/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
