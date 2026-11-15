import { defineConfig } from "@playwright/test";
// E2E_PORT lets two checkouts run the browser tests at the same time.
const port = Number(process.env.E2E_PORT ?? 4173);
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 2,
  reporter: "list",
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
    ...(process.env.TEST_FIREFOX === "1"
      ? [{ name: "firefox", use: { browserName: "firefox" as const } }]
      : []),
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run preview --prefix client -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
