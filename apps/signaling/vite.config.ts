/**
 * Build of the signaling service.
 *
 * The workspace packages are TypeScript sources, so they are bundled in rather than
 * published: the result is a plain `dist/main.js` that runs on any Node 22 with the
 * `ws` dependency installed. `ws` itself stays external — it is a real runtime
 * dependency, not part of this code.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: 'src/main.ts',
    outDir: 'dist',
    target: 'node22',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'main.js' },
    },
  },
  ssr: {
    // `ws` is a genuine runtime dependency and stays external; everything else
    // (zod, and the workspace packages written in TypeScript) is bundled, so the
    // published archive runs with `ws` alone — no workspace, no build step.
    external: ['ws'],
    noExternal: true,
  },
});
