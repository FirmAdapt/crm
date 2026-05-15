<template>
  <LayoutHeader>
    <template #left-header>
      <Breadcrumbs :items="[{ label: __('Integrations') }]" />
    </template>
  </LayoutHeader>

  <div class="overflow-auto px-5 py-6">
    <div class="mb-6 max-w-3xl text-sm text-ink-gray-7">
      {{
        __(
          'Outbound CRM integrations. Each one has its own Settings ' +
            'doctype on the Frappe Desk side — click into a card to ' +
            "configure credentials, rate limits, and webhook URLs. " +
            "All integrations are gated off by default; admins flip the " +
            "Enabled switch once credentials are entered.",
        )
      }}
    </div>

    <div
      class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2 max-w-6xl"
    >
      <IntegrationCard
        v-for="card in cards"
        :key="card.slug"
        v-bind="card"
      />
    </div>

    <div class="mt-8 max-w-3xl text-xs text-ink-gray-5">
      {{
        __(
          'The links above open the Frappe Desk in a new tab. Bookmark ' +
            'this page (/crm/integrations) for quick access — it lives ' +
            'in the sidebar under your admin role.',
        )
      }}
    </div>
  </div>
</template>

<script setup>
import LayoutHeader from '@/components/LayoutHeader.vue'
import { Breadcrumbs } from 'frappe-ui'
import IntegrationCard from '@/components/IntegrationCard.vue'

// Static catalogue. Each card carries its own colour + icon + the
// set of admin-only deep links into Desk. We don't query live status
// per card here — that would require a custom endpoint per Settings
// doctype, which is more wire-up than the value of seeing a
// pre-load badge. The user clicks in, the Settings page itself
// shows the live "Disabled" / "Enabled" state in its header.
const cards = [
  {
    slug: 'autoklose',
    name: 'Autoklose',
    tagline: 'Email outreach campaigns + cadence controls',
    description:
      'Push leads into Autoklose sequences, run campaigns, ' +
      'and ingest reply / open / click webhooks back into the Lead ' +
      'activity timeline.',
    color: 'blue',
    links: [
      { label: 'Settings', href: '/app/autoklose-settings' },
      { label: 'Campaigns (SPA)', route: { name: 'Campaigns' } },
    ],
  },
  {
    slug: 'twilio',
    name: 'Twilio',
    tagline: 'Click-to-call outbound dialing',
    description:
      'REST-driven two-leg dial: Twilio rings the rep first, then ' +
      'bridges to the Lead. CRM Call Log rows are updated by the ' +
      'status-callback webhook. Phase 1 — no recording, single ' +
      'shared from-number.',
    color: 'green',
    links: [{ label: 'Settings', href: '/app/twilio-settings' }],
  },
  {
    slug: 'linkedin-questor',
    name: 'LinkedIn Questor',
    tagline: 'LinkedIn profile + company enrichment (RapidAPI)',
    description:
      'Per-Lead enrichment from a LinkedIn profile URL. Returns profile data, ' +
      'company info, Open-to-Work / Open-Profile flags, and recent activity ' +
      'recency. Existing-wins mapping — never overwrites rep edits. ' +
      'Credit costs documented per call in Settings.',
    color: 'blue',
    links: [
      { label: 'Settings', href: '/app/linkedin-questor-settings' },
    ],
  },
  {
    slug: 'betterenrich',
    name: 'BetterEnrich',
    tagline: 'Waterfall email / phone / social discovery',
    description:
      'Find work / personal email, mobile phone, LinkedIn URL from ' +
      'name + domain. Costly per-credit pricing — every call is ' +
      'gated by a 3-layer rate limit (per-user defaults / per-user ' +
      'overrides / global site caps). Audit log + quota badge in SPA.',
    color: 'gray',
    links: [
      { label: 'Settings', href: '/app/betterenrich-settings' },
      { label: 'User limits', href: '/app/betterenrich-user-limit' },
      { label: 'Usage log', href: '/app/betterenrich-usage-log' },
    ],
  },
]
</script>
