import { test as setup } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_FILE = 'tests/e2e/.auth/admin.json';

// IMPORTANT: this setup project runs WITHOUT a pre-loaded storageState
// (see playwright.config.ts) so every run starts from a clean slate.
// We always perform a fresh login + save — caching the auth across runs
// was tried first, but Frappe's session cookies expire / get invalidated
// between dev-container restarts and produced confusing failures
// downstream.
setup('authenticate as admin', async ({ page, context }) => {
  // Ensure the .auth directory exists.
  const authDir = path.dirname(AUTH_FILE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Clear any cookies the setup project might have inherited so the
  // first navigation is unauthenticated and the login form actually
  // renders.
  await context.clearCookies();

  await page.goto('/login#login');

  // Frappe occasionally redirects an already-authenticated session past
  // /login. If we land on /app or /crm directly we're done — just save.
  const url = page.url();
  if (/\/(app|crm)/.test(url)) {
    await context.storageState({ path: AUTH_FILE });
    return;
  }

  await page.waitForSelector('input[name="login_email"], #login_email', {
    timeout: 10_000,
  });

  await page.fill('input[name="login_email"], #login_email', 'Administrator');
  await page.fill('input[name="login_password"], #login_password', 'admin');
  await page.click('button[type="submit"]');

  await page.waitForURL(/\/(app|crm)/, { timeout: 15_000 });
  await context.storageState({ path: AUTH_FILE });
});
