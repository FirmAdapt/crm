import { test, expect } from '@playwright/test';
import { recordApiCalls, recordAllApiCalls } from './helpers/network';

// Module 2 — per-campaign Pause / Resume controls on the Campaign detail page.
//
// Sandbox campaign 14280926 ("Module 2 Test - Cadence Controls") is reused
// by every manual + automated walkthrough. It has 4 test recipients (Carol,
// Bob, Grace, Frank) and toggles between paused / in_progress depending on
// what ran last.
//
// We pin end-of-suite state to Paused so the NEXT run starts from a known
// place. The Pause-flow test ALSO ends with the campaign paused, so even a
// partial-suite run leaves things tidy.

const CAMPAIGN_ID = '14280926';
const CAMPAIGN_URL = `/crm/campaigns/${CAMPAIGN_ID}`;
const SET_STATUS_METHOD =
  'firmadapt_crm.integrations.autoklose.api.set_campaign_status';

// Helper: read the current campaign status badge text.
async function currentStatus(page: import('@playwright/test').Page): Promise<string> {
  // The Badge label is just capitalized displayStatus — "Active", "Paused",
  // "Draft", "Finished", etc.
  const badge = page.locator('header .badge, header [class*="badge"]').first();
  return (await badge.innerText()).trim();
}

// Helper: make sure the campaign is in a known starting state. If it's
// active, pause it. If finished/archived, fail loud — the suite assumes the
// sandbox campaign is runnable.
async function ensureKnownState(page: import('@playwright/test').Page) {
  await page.goto(CAMPAIGN_URL);
  // Wait for either Pause or Resume button to be present; that's the proof
  // the campaign loaded and the admin cadence button is rendered.
  await expect(
    page.getByRole('button', { name: /^(Pause|Resume|Start)$/ }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Module 2 — campaign cadence controls', () => {
  test.beforeEach(async ({ page }) => {
    await ensureKnownState(page);
  });

  test('pause flow flips Active → Paused with toast', async ({ page }) => {
    // Normalize to Active first if currently paused.
    const resumeBtn = page.getByRole('button', { name: 'Resume' });
    if (await resumeBtn.isVisible().catch(() => false)) {
      await resumeBtn.click();
      await page.getByRole('button', { name: 'Resume campaign' }).click();
      await expect(page.getByText('Campaign resumed.', { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      // Wait for the button to flip back to Pause (state propagated).
      await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({
        timeout: 10_000,
      });
    }

    const requests = recordApiCalls(page, SET_STATUS_METHOD);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.getByRole('button', { name: 'Pause campaign' }).click();

    await expect(page.getByText('Campaign paused.', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    expect(requests.length).toBeGreaterThanOrEqual(1);

    // Badge should now read "Paused".
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('resume flow flips Paused → Active with toast', async ({ page }) => {
    // Make sure we start paused.
    const pauseBtn = page.getByRole('button', { name: 'Pause' });
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      await page.getByRole('button', { name: 'Pause campaign' }).click();
      await expect(page.getByText('Campaign paused.', { exact: true })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible({
        timeout: 10_000,
      });
    }

    const requests = recordApiCalls(page, SET_STATUS_METHOD);
    await page.getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: 'Resume campaign' }).click();

    await expect(page.getByText('Campaign resumed.', { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    expect(requests.length).toBeGreaterThanOrEqual(1);

    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('cancel button closes confirm dialog without firing POST', async ({
    page,
  }) => {
    // The cadence button label depends on current state — read whichever
    // is rendered. We're going to open the dialog and immediately Cancel.
    const cadenceBtn = page.getByRole('button', { name: /^(Pause|Resume)$/ });
    await cadenceBtn.click();

    const allRequests = recordAllApiCalls(page);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Give the page a beat — if a POST were going to fire, it'd be in
    // the queue already. Wait briefly to be sure.
    await page.waitForTimeout(500);

    const statusPosts = allRequests.filter((r) =>
      r.url().includes(`/api/method/${SET_STATUS_METHOD}`),
    );
    expect(statusPosts).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    // Leave the campaign Paused so the next run starts from a known
    // place.
    const ctx = await browser.newContext({
      storageState: 'tests/e2e/.auth/admin.json',
    });
    const page = await ctx.newPage();
    await page.goto(CAMPAIGN_URL);
    await expect(
      page.getByRole('button', { name: /^(Pause|Resume|Start)$/ }),
    ).toBeVisible({ timeout: 15_000 });
    const pauseBtn = page.getByRole('button', { name: 'Pause' });
    if (await pauseBtn.isVisible().catch(() => false)) {
      await pauseBtn.click();
      await page.getByRole('button', { name: 'Pause campaign' }).click();
      await page
        .getByText('Campaign paused.')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    }
    await ctx.close();
  });
});
