import type { Page, Request } from '@playwright/test';

/**
 * Records all API requests made by the page that match a given Frappe method path.
 *
 * Usage:
 *   const requests = recordApiCalls(page, 'firmadapt_crm.integrations.autoklose.api.bulk_push_leads');
 *   // ... trigger UI action ...
 *   expect(requests.length).toBe(1);
 *   const body = requests[0].postDataJSON();
 *   expect(typeof body.campaign_id).toBe('string');
 */
export function recordApiCalls(page: Page, methodPath: string): Request[] {
  const requests: Request[] = [];
  page.on('request', (req) => {
    if (req.url().includes(`/api/method/${methodPath}`)) {
      requests.push(req);
    }
  });
  return requests;
}

/**
 * Tracks ALL Frappe method API requests — useful when asserting that NO POST
 * was fired (e.g. Cancel button on a confirm dialog).
 */
export function recordAllApiCalls(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/method/')) {
      requests.push(req);
    }
  });
  return requests;
}
