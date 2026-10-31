import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4330",
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "npm run dev -- --ignore-lock --host 127.0.0.1 --port 4330",
    url: "http://127.0.0.1:4330/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PUBLIC_IDENTITY_ISSUER: "http://localhost:4330",
      KARMANCOS_ISSUER: "http://localhost:4330",
      KARMANCOS_SECURE_COOKIES: "false",
    },
  },
});
