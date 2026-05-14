import { test, expect } from '@playwright/test';
import { recordApiCalls, recordAllApiCalls } from './helpers/network';

// Module 3 — Sequence step authoring on the Campaign detail page.
//
// Admin-only Add / Edit / Delete controls live in the Sequence tab. All
// three flow through the same StepEditorModal (Add / Edit) or the inline
// delete-confirm Dialog. POSTs go to:
//
//   firmadapt_crm.integrations.autoklose.step_authoring.create_step
//   firmadapt_crm.integrations.autoklose.step_authoring.update_step
//   firmadapt_crm.integrations.autoklose.step_authoring.delete_step
//
// Sandbox campaign 14280926 starts with 1 sequence step (created during
// earlier dev verification). These tests MUST be sequential and the
// net-step-count change must be zero: Test C creates a step → Test D
// deletes that step → Test E never persists. End-of-suite state matches
// start-of-suite state.

const CAMPAIGN_ID = '14280926';
const SEQUENCE_URL = `/crm/campaigns/${CAMPAIGN_ID}#sequence`;
const CREATE_METHOD =
  'firmadapt_crm.integrations.autoklose.step_authoring.create_step';
const DELETE_METHOD =
  'firmadapt_crm.integrations.autoklose.step_authoring.delete_step';

const TEST_STEP_SUBJECT = 'E2E TEST STEP - delete me';
const INVALID_STEP_SUBJECT = 'Invalid step';

// The frappe-ui HelpModal floats fixed/z-50 on the right side and
// intercepts clicks on a fresh session. Dismiss it before each test —
// same pattern as the Module 1 / Module 6 specs.
async function dismissHelpModal(page: import('@playwright/test').Page) {
  const helpModal = page.locator('div.fixed.z-50.right-0.w-80.shadow-2xl');
  if (await helpModal.isVisible().catch(() => false)) {
    const closeBtn = helpModal.locator('button:has(svg.feather-x)').first();
    await closeBtn.click().catch(() => {});
  }
}

// Wait for the Sequence tab content to render. The step-count line
// (`N step(s)`) is always rendered when the tab is active, even with
// zero steps — it's the reliable "tab is up" marker.
async function waitForSequenceTab(page: import('@playwright/test').Page) {
  await expect(
    page.getByText(/^\d+\s+step\(s\)$/),
  ).toBeVisible({ timeout: 15_000 });
}

// Open the Step editor in CREATE mode by clicking "Add step" in the
// tab header. Returns once the modal title is visible.
async function openAddStepModal(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Add step', exact: true }).click();
  await expect(
    page.getByText('Add sequence step', { exact: true }),
  ).toBeVisible({ timeout: 5_000 });
}

// Fill the modal form. Pass undefined for any field to skip it.
async function fillStepForm(
  page: import('@playwright/test').Page,
  fields: { subject?: string; sendAfterDays?: number; body?: string },
) {
  if (fields.subject !== undefined) {
    const subject = page
      .locator('input[type="text"]')
      .filter({
        hasNot: page.locator('[placeholder*="preheader"]'),
      })
      .first();
    await subject.fill(fields.subject);
  }
  if (fields.sendAfterDays !== undefined) {
    const days = page.locator('input[type="number"]').first();
    await days.fill(String(fields.sendAfterDays));
  }
  if (fields.body !== undefined) {
    // The body is a plain <textarea> (Module 3 ships without a rich-text
    // editor on purpose). There's only one textarea inside the modal.
    const body = page.locator('textarea').first();
    await body.fill(fields.body);
  }
}

test.describe('Module 3 — sequence step authoring', () => {
  // Single serial describe-block — every test depends on previous state.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto(SEQUENCE_URL);
    await page.waitForLoadState('networkidle');
    await dismissHelpModal(page);
    await waitForSequenceTab(page);
  });

  // Case A — Sequence tab loads with controls visible.
  test('A: Sequence tab renders count + Add step button', async ({ page }) => {
    await expect(
      page.getByText(/^\d+\s+step\(s\)$/),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Add step', exact: true }),
    ).toBeVisible();
  });

  // Case B — Add step → Cancel: modal closes, no POST.
  test('B: Add step + Cancel does not fire create POST', async ({ page }) => {
    await openAddStepModal(page);

    const requests = recordApiCalls(page, CREATE_METHOD);
    const allRequests = recordAllApiCalls(page);

    // The Dialog's Cancel action has no onClick handler — it closes the
    // dialog. Both the explicit Cancel button and the X close icon work;
    // we use the labelled button (more representative of real usage).
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    await expect(
      page.getByText('Add sequence step', { exact: true }),
    ).not.toBeVisible({ timeout: 5_000 });

    // Give the page a beat — any in-flight POST would be queued by now.
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(0);
    const creates = allRequests.filter((r) =>
      r.url().includes(`/api/method/${CREATE_METHOD}`),
    );
    expect(creates).toHaveLength(0);
  });

  // Case C — Add step → Create: POST fires, modal closes, list updates.
  test('C: Create step persists and appears in the sequence list', async ({
    page,
  }) => {
    await openAddStepModal(page);
    await fillStepForm(page, {
      subject: TEST_STEP_SUBJECT,
      sendAfterDays: 2,
      body: '<p>E2E test body.</p>',
    });

    const requests = recordApiCalls(page, CREATE_METHOD);

    await page.getByRole('button', { name: 'Create step', exact: true }).click();

    // Wait for the modal to close (Dialog body unmounts on close).
    await expect(
      page.getByText('Add sequence step', { exact: true }),
    ).not.toBeVisible({ timeout: 15_000 });

    expect(requests.length).toBeGreaterThanOrEqual(1);

    // After campaign.reload() the new step row appears. The subject
    // text is rendered inline next to "Subject:" in the step card.
    await expect(
      page.getByText(TEST_STEP_SUBJECT, { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  // Case D — Delete the step Test C created.
  test('D: Delete step removes it from the list', async ({ page }) => {
    // Find the step card that contains our test subject. Each step is
    // wrapped in a `rounded border` div — match by descendant subject.
    const stepCard = page
      .locator('div.rounded.border.border-outline-gray-1')
      .filter({ hasText: TEST_STEP_SUBJECT });
    await expect(stepCard).toBeVisible({ timeout: 10_000 });

    // The Delete button is the red subtle Button inside the same card.
    await stepCard.getByRole('button', { name: 'Delete', exact: true }).click();

    // Red confirm dialog assertions — destructive CTA ("Delete step")
    // + explicit Cancel.
    await expect(
      page.getByText('Delete this sequence step?', { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole('button', { name: 'Delete step', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();

    const requests = recordApiCalls(page, DELETE_METHOD);
    await page.getByRole('button', { name: 'Delete step', exact: true }).click();

    // Toast confirms server success; the campaign.reload() then drops
    // the row from the list.
    await expect(
      page.getByText('Sequence step deleted.', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });

    expect(requests.length).toBeGreaterThanOrEqual(1);

    // The deleted step's subject should no longer be visible.
    await expect(
      page.getByText(TEST_STEP_SUBJECT, { exact: false }),
    ).not.toBeVisible({ timeout: 15_000 });
  });

  // Case E — Invalid send_after_days (0) is rejected.
  //
  // The SPA enforces a client-side guard (StepEditorModal.vue: days < 1
  // emits a toast and bails before posting). That's the path actually
  // hit when a user types 0 and clicks Create — the Autoklose 422 we'd
  // see on a raw POST never fires in practice. We assert the error
  // toast surfaces "at least" or "1" and that the bad step never lands.
  test('E: send_after_days=0 surfaces an error and does not persist', async ({
    page,
  }) => {
    await openAddStepModal(page);
    await fillStepForm(page, {
      subject: INVALID_STEP_SUBJECT,
      sendAfterDays: 0,
      body: '<p>Should be rejected.</p>',
    });

    const requests = recordApiCalls(page, CREATE_METHOD);
    await page.getByRole('button', { name: 'Create step', exact: true }).click();

    // The client guard fires immediately. The exact toast copy is
    // "Send after days must be at least 1." — match the "1" / "at least"
    // hint per the task spec to stay tolerant of minor copy edits.
    const toast = page
      .locator('[role="status"], .toast, [class*="toast"]')
      .filter({ hasText: /at least|\s1\b/i });
    await expect(toast.first()).toBeVisible({ timeout: 10_000 });

    // Step never persisted. The modal may stay open (client-side guard
    // doesn't close it) — close it explicitly to leave state clean for
    // any subsequent suite.
    const cancelBtn = page.getByRole('button', { name: 'Cancel', exact: true });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }

    // No create POST fired (client guard intercepts).
    expect(requests).toHaveLength(0);

    // And the invalid subject is not in the rendered list.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await waitForSequenceTab(page);
    await expect(
      page.getByText(INVALID_STEP_SUBJECT, { exact: false }),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});
