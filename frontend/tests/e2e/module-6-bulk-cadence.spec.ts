import { test, expect } from '@playwright/test';
import { recordApiCalls, recordAllApiCalls } from './helpers/network';

// Module 6 (Part A) — bulk Pause / Resume from the Campaigns list view.
//
// We open the list, multi-select 2 campaigns (the sandbox 14280926 + any
// other one), and exercise the bulk-cadence flow. The toast format is:
//
//   all-ok:    "{Resumed|Paused} N campaign(s)."
//   mixed:     "{Resumed|Paused} N ok, M skipped. ..."
//
// Both forms are accepted as PASS — what we're checking is the wiring,
// not the underlying Autoklose state machine.

const BULK_CADENCE_METHOD =
  'firmadapt_crm.integrations.autoklose.api.bulk_set_campaign_status';
const LIST_URL = '/crm/campaigns/view/list';

async function selectFirstTwoRows(page: import('@playwright/test').Page) {
  // The frappe-ui ListView renders rows in a <div>-based grid (not a
  // <table>) with one <input type="checkbox"> per row when
  // selectable=true. The select-all checkbox lives in the column header
  // and is typically the first match; row checkboxes follow.
  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes.first()).toBeVisible({ timeout: 15_000 });
  // Skip index 0 (select-all) and check the next two row checkboxes.
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();
}

async function openBulkMenu(page: import('@playwright/test').Page) {
  // The ListSelectBanner is rendered as
  //   <div class="absolute inset-x-0 bottom-6 ..."> ... </div>
  // when at least one row is selected. We scope the more-horizontal
  // button to that banner so we don't pick up the HelpModal's own
  // more-horizontal button (which has the same icon class).
  const moreBtn = page
    .locator('div.absolute.bottom-6 button:has(svg.feather-more-horizontal)')
    .first();
  await expect(moreBtn).toBeVisible({ timeout: 5_000 });
  await moreBtn.click();
}

// Dismiss the auto-opened frappe-ui HelpModal — it's a fixed/z-50 side
// panel that intercepts clicks on the right side of the viewport and
// pops up on a fresh session. The user-flow tests do their work in the
// main content area, so closing the modal first is the cleanest way
// to prevent intermittent overlay-intercept failures.
async function dismissHelpModal(page: import('@playwright/test').Page) {
  const helpModal = page.locator('div.fixed.z-50.right-0.w-80.shadow-2xl');
  if (await helpModal.isVisible().catch(() => false)) {
    // The X close button sits inside the modal header; matching by
    // feather "x" icon scoped to the modal works regardless of label.
    const closeBtn = helpModal
      .locator('button:has(svg.feather-x)')
      .first();
    await closeBtn.click().catch(() => {});
  }
}

test.describe('Module 6 — bulk campaign cadence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(LIST_URL);
    await page.waitForLoadState('networkidle');
    await dismissHelpModal(page);
  });

  test('Resume selected fires bulk POST + shows results toast', async ({
    page,
  }) => {
    await selectFirstTwoRows(page);
    await openBulkMenu(page);

    const requests = recordApiCalls(page, BULK_CADENCE_METHOD);
    await page.getByRole('menuitem', { name: 'Resume selected' }).click();
    await page.getByRole('button', { name: 'Resume campaigns' }).click();

    // Accept either all-ok or mixed toast text.
    const toast = page.locator('[role="status"], .toast, [class*="toast"]')
      .filter({ hasText: /Resumed \d+/i });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });
    expect(requests.length).toBeGreaterThanOrEqual(1);
  });

  test('Pause selected fires bulk POST + shows results toast', async ({
    page,
  }) => {
    await selectFirstTwoRows(page);
    await openBulkMenu(page);

    const requests = recordApiCalls(page, BULK_CADENCE_METHOD);
    await page.getByRole('menuitem', { name: 'Pause selected' }).click();
    await page.getByRole('button', { name: 'Pause campaigns' }).click();

    const toast = page.locator('[role="status"], .toast, [class*="toast"]')
      .filter({ hasText: /Paused \d+/i });
    await expect(toast.first()).toBeVisible({ timeout: 15_000 });
    expect(requests.length).toBeGreaterThanOrEqual(1);
  });

  test('Cancel in bulk dialog does NOT fire a POST', async ({ page }) => {
    await selectFirstTwoRows(page);
    await openBulkMenu(page);

    await page.getByRole('menuitem', { name: 'Resume selected' }).click();

    const allRequests = recordAllApiCalls(page);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.waitForTimeout(500);

    const bulkPosts = allRequests.filter((r) =>
      r.url().includes(`/api/method/${BULK_CADENCE_METHOD}`),
    );
    expect(bulkPosts).toHaveLength(0);
  });
});
