import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 120000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
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
  webServer: {
    command: "npm run dev:local",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
