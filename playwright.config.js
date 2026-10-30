import { defineConfig, devices } from "@playwright/test";
const liveURL = process.env.CAMBIO_LIVE_URL;
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  expect: { timeout: liveURL ? 20000 : 5000 },
  use: {
    baseURL: liveURL || "http://127.0.0.1:5173",
    trace: { mode: "retain-on-failure", screenshots: false, snapshots: true },
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    { name: "webkit-iphone", use: { ...devices["iPhone 13"] } },
  ],
  webServer: liveURL ? undefined : {
    command: "npm run dev:local",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
