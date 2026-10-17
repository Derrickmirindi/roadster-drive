// Shared Playwright launcher for the end-to-end checks (software WebGL in headless Chromium).
import { chromium } from 'playwright';
export async function launch() {
  return chromium.launch({
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
}
export const BASE = process.env.BASE_URL || 'http://localhost:4173/';
