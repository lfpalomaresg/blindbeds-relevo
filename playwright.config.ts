import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { localSupabaseEnv } from "./e2e/local-guard";

// Synthetic end-to-end journeys against LOCAL Supabase only (see e2e/README.md).
// Checked here, while loading the config, because Playwright starts the web
// server before the global setup. Throws unless the app would see 127.0.0.1.
const dotenvPath = path.join(__dirname, ".env.local");
const supabaseEnv = localSupabaseEnv(process.env, existsSync(dotenvPath) ? readFileSync(dotenvPath, "utf8") : "");

// Its own port and never reuse a running server: one started with other
// variables (a cloud project) would pass every check above.
const PORT = 3300;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One shared local database: journeys run in order, one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "e2e-results/artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "e2e-results/results.json" }],
    ["html", { outputFolder: "e2e-results/html", open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    ...devices["Pixel 7"],
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    env: supabaseEnv,
    timeout: 120_000,
  },
});
