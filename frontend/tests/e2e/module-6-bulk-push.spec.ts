import { test, expect } from '@playwright/test';
import { recordApiCalls } from './helpers/network';

// Module 6 (Part B) — bulk Push-to-Autoklose from the Leads list.
//
// What we verify:
//   1. The modal opens with the expected title.
//   2. The campaign picker is filtered to push-eligible statuses
//      (active / in_progress / paused) — finished + archived must NOT
//      appear.
//   3. The helper line under the picker reads
//      "Status: <status> · Current recipients: <n>".
//   4. The POST body sends `campaign_id` as a STRING — not the full
//      Autocomplete option object. (Regression test for the v-model dict
//      bug we hit during manual QA.)
//   5. The result toast matches either the all-ok or mixed-results
//      pattern. Both are PASS; we care about wiring, not Autoklose
//      duplicate handling.

const PUSH_METHOD =
  'firmadapt_crm.integrations.autoklose.api.bulk_push_leads';
const LEADS_LIST = '/crm/leads/view/list';
const TARGET_CAMPAIGN_LABEL = 'Module 2 Test - Cadence Controls';

async function selectFirstTwoLeads(page: import('@playwright/test').Page) {
  // frappe-ui ListView uses <input type="checkbox"> inside a <div>
  // grid — there's no <table>. Index 0 is the column-header select-all
  // checkbox; we want the next two rows.
  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes.first()).toBeVisible({ timeout: 15_000 });
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();
}

// Dismiss the auto-opened frappe-ui HelpModal (fixed side panel) so it
// doesn't intercept clicks on the right side of the viewport.
async function dismissHelpModal(page: import('@playwright/test').Page) {
  const helpModal = page.locator('div.fixed.z-50.right-0.w-80.shadow-2xl');
  if (await helpModal.isVisible().catch(() => false)) {
    const closeBtn = helpModal
      .locator('button:has(svg.feather-x)')
      .first();
    await closeBtn.click().catch(() => {});
  }
}

test.describe('Module 6 — bulk push to Autoklose', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LEADS_LIST);
    await page.waitForLoadState('networkidle');
    await dismissHelpModal(page);
  });

  test('opens modal, picks campaign, posts string campaign_id, renders toast', async ({
    page,
  }) => {
    await selectFirstTwoLeads(page);

    // Open the bulk-action ⋯ menu. Scope the more-horizontal button to
    // the ListSelectBanner (.absolute.bottom-6) so we don't pick up
    // the HelpModal's own dropdown trigger.
    const moreBtn = page
      .locator('div.absolute.bottom-6 button:has(svg.feather-more-horizontal)')
      .first();
    await expect(moreBtn).toBeVisible({ timeout: 5_000 });
    await moreBtn.click();
    await page.getByRole('menuitem', { name: 'Push to Autoklose' }).click();

    // Modal opens with the expected title.
    await expect(
      page.getByText('Push selected leads to Autoklose'),
    ).toBeVisible({ timeout: 10_000 });

    // Open the campaign picker. The local Autocomplete wrapper renders
    // the closed state as a <button> with the placeholder text inside a
    // <div>, NOT a real input — so we click the button to open the
    // popover, then fill the inner ComboboxInput (placeholder "Search").
    const pickerTrigger = page.locator('button', {
      hasText: 'Search campaigns…',
    });
    await expect(pickerTrigger).toBeVisible({ timeout: 5_000 });
    await pickerTrigger.click();

    const searchInput = page.getByPlaceholder('Search', { exact: true });
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Eligible-status filter spot-check: with an empty search, the
    // picker should NOT surface a finished campaign labelled exactly
    // "TEST". Server-side filter is `status in [active, in_progress,
    // paused]`, so finished/archived are absent.
    await searchInput.fill('TEST');
    await page.waitForTimeout(500);
    const finishedOption = page
      .locator('li, [role="option"]')
      .filter({ hasText: /^TEST$/ });
    await expect(finishedOption).toHaveCount(0);

    // Now narrow to the sandbox campaign and pick it.
    await searchInput.fill('Module 2 Test');
    const option = page
      .locator('li, [role="option"]')
      .filter({ hasText: TARGET_CAMPAIGN_LABEL })
      .first();
    await expect(option).toBeVisible({ timeout: 5_000 });
    await option.click();

    // Helper line under the picker.
    await expect(
      page.getByText(/Status:\s*\w+\s*·\s*Current recipients:\s*\d+/i),
    ).toBeVisible({ timeout: 5_000 });

    const requests = recordApiCalls(page, PUSH_METHOD);
    await page.getByRole('button', { name: 'Push to Autoklose' }).click();

    // Either success or mixed-results toast pattern is acceptable.
    const toast = page
      .locator('[role="status"], .toast, [class*="toast"]')
      .filter({
        hasText: /Pushed \d+ (lead\(s\) to Autoklose\.|ok, \d+ skipped)/i,
      });
    await expect(toast.first()).toBeVisible({ timeout: 20_000 });

    // ----- Regression: campaign_id must be a STRING ------------------
    expect(requests.length).toBeGreaterThanOrEqual(1);
    const body = requests[0].postDataJSON();
    expect(typeof body.campaign_id).toBe('string');
    expect(body.campaign_id.length).toBeGreaterThan(0);
    // lead_names is the array of selected lead ids.
    expect(Array.isArray(body.lead_names)).toBe(true);
    expect(body.lead_names.length).toBe(2);
  });
});
