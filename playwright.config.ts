/**
 * End-to-end tests in **real browsers**.
 *
 * What the unit tests cannot prove, and what this suite exists for: that two devices
 * open in two browsers reach each other through the real signaling service, transfer
 * a real file over a real WebRTC data channel, and that the bytes the receiver ends up
 * with are byte-for-byte the bytes that were sent. The unit tests replace the
 * transport, the file system and the DOM; here nothing is replaced.
 *
 * They run against the **packaged** application (`vite build` + `vite preview`) with
 * the real signaling service, on separate origins/contexts, each with its own storage
 * — the closest thing to two devices that a CI machine can offer.
 *
 * Browsers are downloadable in CI only: locally, `npx playwright install` works if the
 * machine can reach the Playwright CDN. See `docs/TESTING.md`.
 */
import { defineConfig, devices } from '@playwright/test';

const WEB_ORIGIN = process.env['DROPFORGE_E2E_ORIGIN'] ?? 'http://127.0.0.1:4173';
const SIGNALING_ORIGIN = process.env['DROPFORGE_SIGNALING_ORIGIN'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  testDir: './e2e',
  // A transfer test needs the two contexts to be alive at the same time; parallelism is
  // per-file, and each file owns its own pair of devices.
  fullyParallel: false,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  workers: process.env['CI'] !== undefined ? 1 : undefined,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env['CI'] !== undefined ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Downloads are how a browser receiver gets its file without the File System
    // Access picker (which cannot be automated): the suite captures them and checks
    // their content. See `e2e/helpers/app.ts`.
    acceptDownloads: true,
  },
  projects: [
    {
      // The reference pair: desktop Chromium, where WebRTC, File System Access and the
      // service worker all exist.
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts|safari\.spec\.ts|firefox\.spec\.ts/,
    },
    {
      // The same product on a phone-sized screen: layout, bottom navigation, and the
      // fact that a transfer works there too.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /mobile\.spec\.ts/,
    },
    {
      // Firefox: the third engine, and the only one without File System Access in the
      // automation build — which is what makes its download-fallback path worth testing.
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: /firefox\.spec\.ts/,
    },
    {
      // WebKit on a phone: what DropForge promises (and refuses to promise) on iOS.
      // No transfer is attempted here on purpose — see `safari.spec.ts`.
      name: 'ios-safari',
      use: { ...devices['iPhone 14'] },
      testMatch: /safari\.spec\.ts/,
    },
  ],
  webServer: [
    {
      // The signaling service is started for real: the two browsers meet through it.
      command: 'npm run start:signaling',
      url: `${SIGNALING_ORIGIN}/health`,
      reuseExistingServer: process.env['CI'] === undefined,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // The application is tested as it is distributed: built, then served. The build
      // happens here so the suite can never pass against a stale `dist/`.
      command: 'npm run build:web && npm run preview -w @dropforge/web',
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
