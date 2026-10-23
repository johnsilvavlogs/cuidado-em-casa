import { defineConfig, chromium } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const cache = resolve(homedir(), "Library/Caches/ms-playwright");
const candidates = [chromium.executablePath(), ...readdirSync(cache)
  .filter((name) => /^chromium-\d+$/.test(name))
  .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
  .map((name) => resolve(cache, name, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"))];
const executablePath = candidates.find(existsSync);
if (!executablePath) throw new Error("No installed Chromium binary found; this test does not install browsers.");

export default defineConfig({
  testDir: ".",
  testMatch: "*.integration.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: resolve(process.env.CARE_E2E_OUTPUT || "output/e2e/voice-ui", "artifacts"),
  reporter: [["line"], ["json", { outputFile: resolve(process.env.CARE_E2E_OUTPUT || "output/e2e/voice-ui", "playwright-report.json") }]],
  use: {
    baseURL: process.env.CARE_E2E_BASE_URL || "http://127.0.0.1:3000",
    headless: true,
    viewport: { width: 1100, height: 900 },
    timezoneId: "America/Sao_Paulo",
    launchOptions: { executablePath },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
