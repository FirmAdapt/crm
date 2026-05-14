import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Module 8 — Reporting polish on the Campaign detail page.
//
// Two surfaces this spec covers:
//   1. Per-step engagement breakdown table on the Engagement tab.
//   2. "Export CSV" button on the Recipients tab — backend method:
//      firmadapt_crm.integrations.autoklose.reporting.export_recipients_csv
//
// Sandbox campaign 14280926 has 1 sequence step + 6 recipients at the
// time these tests were authored. We assert on column shape, row count
// consistency, and the file-name + header line — not on absolute
// counts (Autoklose engagement numbers shift between runs).

const CAMPAIGN_ID = '14280926';
const ENGAGEMENT_URL = `/crm/campaigns/${CAMPAIGN_ID}#engagement`;
const RECIPIENTS_URL = `/crm/campaigns/${CAMPAIGN_ID}#recipients`;
const EXPECTED_CSV_FILENAME = `recipients-${CAMPAIGN_ID}.csv`;
// Keep in lockstep with reporting.py:_CSV_COLUMNS. If the backend
// reorders/renames columns, mirror the change here.
const EXPECTED_CSV_HEADER =
  'email,lead_name,first_contacted_at,last_contacted_at,next_email_send_date,completed_at';

async function dismissHelpModal(page: import('@playwright/test').Page) {
  const helpModal = page.locator('div.fixed.z-50.right-0.w-80.shadow-2xl');
  if (await helpModal.isVisible().catch(() => false)) {
    const closeBtn = helpModal.locator('button:has(svg.feather-x)').first();
    await closeBtn.click().catch(() => {});
  }
}

test.describe('Module 8 — reporting polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/crm/campaigns/${CAMPAIGN_ID}`);
    await page.waitForLoadState('networkidle');
    await dismissHelpModal(page);
  });

  // Case A — Engagement tab renders the per-step breakdown alongside
  // the existing funnel.
  test('A: Engagement tab shows funnel + per-step breakdown', async ({
    page,
  }) => {
    await page.goto(ENGAGEMENT_URL);
    await page.waitForLoadState('networkidle');

    // The Funnel section header proves the existing funnel rendering
    // still mounts (Module 8 must not regress Module 7).
    await expect(
      page.getByText('Funnel', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Per-step heading.
    await expect(
      page.getByText('Per-step breakdown', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    // Wait out the loading state (perStepStats may fetch from
    // Autoklose); then assert at least one row exists. The Campaign
    // has 1 step at minimum.
    const loadingLine = page.getByText('Loading per-step stats…', {
      exact: true,
    });
    await loadingLine.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});

    // The per-step table is scoped under the "Per-step breakdown"
    // heading — it's the second <table> on the Engagement tab (first
    // is the Recipients tab's, which isn't rendered here). Scope to
    // any table whose <thead> includes "Step" + "Subject".
    const perStepTable = page.locator('table').filter({
      has: page.locator('th', { hasText: 'Subject' }),
    });
    await expect(perStepTable).toBeVisible({ timeout: 10_000 });
    const rowCount = await perStepTable.locator('tbody tr').count();
    expect(rowCount).toBeGreaterThanOrEqual(1);
  });

  // Case B — per-step row exposes numeric cells (or em-dash for
  // unreported metrics).
  test('B: per-step row exposes numeric / em-dash cells', async ({ page }) => {
    await page.goto(ENGAGEMENT_URL);
    await page.waitForLoadState('networkidle');
    const loadingLine = page.getByText('Loading per-step stats…', {
      exact: true,
    });
    await loadingLine.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => {});

    const perStepTable = page.locator('table').filter({
      has: page.locator('th', { hasText: 'Subject' }),
    });
    await expect(perStepTable).toBeVisible({ timeout: 10_000 });

    // Inspect the first data row. Each row has 8 cells in the order:
    //   Step | Subject | Send after | Sent | Unique opens | Unique
    //   clicks | Replied | Bounced
    // The numeric columns render either a number or an em-dash ("—")
    // when Autoklose has no value yet.
    const firstRow = perStepTable.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    const cells = firstRow.locator('td');
    const cellCount = await cells.count();
    expect(cellCount).toBe(8);

    // Pull the right-aligned numeric cells (indices 3..7) and verify
    // each is either an integer string or "—".
    for (let i = 3; i <= 7; i++) {
      const txt = (await cells.nth(i).innerText()).trim();
      expect(txt).toMatch(/^(\d+|—)$/);
    }
  });

  // Case C — Recipients tab renders Export CSV and the click yields a
  // file download with the expected filename + header.
  test('C: Export CSV downloads recipients-<id>.csv with expected header', async ({
    page,
  }) => {
    await page.goto(RECIPIENTS_URL);
    await page.waitForLoadState('networkidle');

    const exportBtn = page.getByRole('button', {
      name: 'Export CSV',
      exact: true,
    });
    await expect(exportBtn).toBeVisible({ timeout: 15_000 });

    // The SPA fires the download via `window.location.href = <api url>`
    // — Playwright fires the `download` event on the Page when the
    // navigation resolves to an attachment response.
    const downloadPromise = page.waitForEvent('download', {
      timeout: 30_000,
    });
    await exportBtn.click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(EXPECTED_CSV_FILENAME);

    const tmpPath = await download.path();
    expect(tmpPath).toBeTruthy();
    const csv = readFileSync(tmpPath!, 'utf-8');

    const lines = csv.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toBe(EXPECTED_CSV_HEADER);
  });

  // Case D — CSV row count matches the Recipients tab header count.
  //
  // The header reads "Total: X / Y" where X is the page-loaded count
  // and Y the total. Y is the truth — and it matches CSV body rows
  // because the export uses the same `frappe.get_all` with the same
  // Pattern-A filters. (X may be less when pagination is in play.)
  test('D: CSV body row count matches Total: count', async ({ page }) => {
    await page.goto(RECIPIENTS_URL);
    await page.waitForLoadState('networkidle');

    // The header reads "Total: X / Y" once both the page-loaded count
    // and the absolute total have come back. Y comes from a separate
    // `frappe.client.get_count` resource so it can lag the recipients
    // list resource — wait until we see the "X / Y" shape AND the data
    // table has at least one row before reading the total. Without
    // this wait we sometimes catch the page mid-load ("Total: 0" on
    // its own) and the assertion fails noisily.
    const totalLocator = page.getByText(/Total:\s*\d+\s*\/\s*\d+/);
    await expect(totalLocator).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('tbody tr').first()).toBeVisible({
      timeout: 15_000,
    });
    const totalText = (await totalLocator.innerText()).trim();
    const m = totalText.match(/Total:\s*(\d+)\s*\/\s*(\d+)/);
    expect(m).not.toBeNull();
    const uiTotal = Number(m![2]);
    expect(uiTotal).toBeGreaterThan(0);

    const downloadPromise = page.waitForEvent('download', {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const download = await downloadPromise;
    const tmpPath = await download.path();
    const csv = readFileSync(tmpPath!, 'utf-8');

    const lines = csv
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.length);
    // First line is the header — body row count is total - 1.
    const bodyRowCount = lines.length - 1;
    expect(bodyRowCount).toBe(uiTotal);
  });
});
