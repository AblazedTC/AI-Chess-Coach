import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const demoEnv = {
  CHESSCOM_MODE: "demo",
  ENGINE_MODE: "demo",
  LLM_PROVIDER: "deterministic",
  CORS_ORIGINS: '["http://127.0.0.1:3100"]',
  NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8100",
};

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: "../test-results",
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/responsive.spec.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      testMatch: "**/responsive.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command:
        "uv --directory backend run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8100",
      cwd: root,
      env: demoEnv,
      url: "http://127.0.0.1:8100/api/health",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command:
        "npm --prefix frontend run dev -- --hostname 127.0.0.1 --port 3100",
      cwd: root,
      env: demoEnv,
      url: "http://127.0.0.1:3100",
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
