<template>
  <!--
    LinkedIn Questor — bulk enrichment modal.

    v0.15.0 UX hardening (fixes audit P0 #1, P1 #4, P1 #5):

      P0 #1 — Pre-flight integration status.
        On mount we hit `get_integration_status` (cached, no upstream
        API call). If the integration is disabled or unconfigured, we
        swap the modal body to a clear "ask an admin" banner with a
        deep-link to the Settings doctype, and the Enrich CTA is
        replaced with "Open Settings" (admins) / disabled (non-admins).
        Before v0.15, admins clicked Enrich on a disabled integration
        and got N copies of the same "integration is disabled" error
        in the toast — pure noise.

      P1 #4 — Default-state visibility on the toggles.
        Each toggle row now shows the resolved Settings default as a
        small gray "default: on/off" chip. Admins can see at a glance
        what they're about to override.

      P1 #5 — Reactive credit estimate.
        The "Estimated cost" line now updates live as toggles change.
        Was previously a static "N × 7 = 14 credits" worst-case that
        never reflected the actual toggle state.

    On confirm: POSTs to bulk_enrich_leads. Emits `done(resp)` to the
    parent (ListBulkActions.vue) which renders the result toast.
  -->
  <Dialog
    v-model="show"
    :options="{
      title: __('Enrich selected leads from LinkedIn'),
      size: 'md',
      actions: dialogActions,
    }"
  >
    <template #body-content>
      <!-- ── LOADING STATE ───────────────────────────────────────── -->
      <!-- v0.15.0 hotfix: the original v-if ordering let the
           ready-state (toggles) render BEFORE the status fetch
           resolved. On prod, integration is disabled by default
           and the toggle UI flashed for the half-second between
           modal open and status arrival. Worse: on a slow network
           an admin could even click Enrich during that window
           before learning the integration is disabled. Resolve
           three states explicitly — loading first, then either
           the disabled banner or the ready toggles. -->
      <div
        v-if="!statusLoaded"
        class="flex items-center justify-center py-8 text-sm text-ink-gray-5"
      >
        <span
          class="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-gray-4 border-t-transparent"
        ></span>
        {{ __('Checking LinkedIn Questor status…') }}
      </div>

      <!-- ── DISABLED / UNCONFIGURED STATE ───────────────────────── -->
      <div v-else-if="!canEnrich" class="space-y-3">
        <div
          class="rounded-md border border-outline-amber-3 bg-surface-amber-2 p-3"
        >
          <div class="text-sm font-medium text-ink-amber-9">
            {{ disabledTitle }}
          </div>
          <div class="mt-1 text-sm text-ink-amber-9">
            {{ disabledBody }}
          </div>
        </div>
        <div class="text-xs text-ink-gray-5">
          {{
            __(
              '{0} lead(s) selected. No credits will be charged until ' +
                'an admin enables the integration.',
              [selectionsCount],
            )
          }}
        </div>
      </div>

      <!-- ── READY STATE ─────────────────────────────────────────── -->
      <div v-else class="space-y-4">
        <div class="text-sm text-ink-gray-7">
          {{
            __(
              "LinkedIn Questor will fetch each Lead's LinkedIn profile " +
                'and fill empty CRM fields (existing values are never ' +
                'overwritten). Leads without a LinkedIn URL are skipped ' +
                'server-side without burning credits.',
            )
          }}
        </div>

        <div class="space-y-3 rounded border border-outline-gray-2 p-3">
          <!-- Signals toggle with default-state chip -->
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <label class="text-ink-gray-8">{{ __('Include signals') }}</label>
              <span
                v-if="!signalsTouched"
                class="rounded-full bg-surface-gray-2 px-2 py-0.5 text-xs text-ink-gray-7"
              >
                {{ __('default: {0}', [defaults.include_signals ? __('on') : __('off')]) }}
              </span>
              <span
                v-else
                class="rounded-full bg-surface-blue-2 px-2 py-0.5 text-xs font-medium text-ink-blue-9"
              >
                {{ __('override') }}
              </span>
            </div>
            <Switch v-model="includeSignals" />
          </div>

          <!-- Company toggle with default-state chip -->
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <label class="text-ink-gray-8">{{ __('Include company data') }}</label>
              <span
                v-if="!companyTouched"
                class="rounded-full bg-surface-gray-2 px-2 py-0.5 text-xs text-ink-gray-7"
              >
                {{ __('default: {0}', [defaults.include_company ? __('on') : __('off')]) }}
              </span>
              <span
                v-else
                class="rounded-full bg-surface-blue-2 px-2 py-0.5 text-xs font-medium text-ink-blue-9"
              >
                {{ __('override') }}
              </span>
            </div>
            <Switch v-model="includeCompany" />
          </div>

          <div class="border-t pt-2 text-xs text-ink-gray-5">
            {{
              __(
                'Skills + certifications use the LinkedIn Questor Settings ' +
                  'defaults. Toggle the per-Lead Dropdown on the Lead ' +
                  'detail page to override those.',
              )
            }}
          </div>
        </div>

        <!-- Live credit estimate: reactive to toggle state -->
        <div
          class="flex items-center justify-between rounded border border-outline-gray-2 bg-surface-gray-1 px-3 py-2 text-sm"
        >
          <div class="text-ink-gray-7">
            {{ __('Estimated cost (per Lead × {0} leads)', [selectionsCount]) }}
          </div>
          <div class="font-medium text-ink-gray-9">
            ≈ {{ estimatedCredits }} {{ __('credit(s)') }}
          </div>
        </div>
        <div
          v-if="status.credits_remaining != null"
          class="text-xs text-ink-gray-5"
        >
          {{
            __(
              'Last known balance: {0} credit(s). Live balance refreshed ' +
                'on each enrichment.',
              [status.credits_remaining],
            )
          }}
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Dialog, Switch, call, createResource } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  selections: { type: [Object, Set, Array, null], default: null },
})

const emit = defineEmits(['done'])

const show = defineModel({ type: Boolean })

const selectionsCount = computed(() => {
  const s = props.selections
  if (!s) return 0
  if (s instanceof Set) return s.size
  if (Array.isArray(s)) return s.length
  return Object.keys(s).length
})

// ─── Integration status (P0 #1 pre-flight) ───────────────────────────
const status = ref({
  enabled: false,
  configured: false,
  role_ok: false,
  credits_remaining: null,
  defaults: {
    include_skills: false,
    include_certifications: false,
    include_signals: false,
    include_company: false,
  },
  credit_costs: {
    profile_base: 1.0,
    profile_skills: 0.5,
    profile_certs: 0.5,
    signals_total: 4.0,
    company: 1.0,
  },
})
const statusLoaded = ref(false)

const statusResource = createResource({
  url: 'firmadapt_crm.integrations.linkedin_questor.api.get_integration_status',
  auto: false,
  onSuccess: (v) => {
    status.value = { ...status.value, ...v }
    statusLoaded.value = true
  },
  onError: () => {
    status.value.enabled = false
    status.value.configured = false
    statusLoaded.value = true
  },
})

// Re-fetch on every open so the admin sees fresh state (they may have
// just enabled the integration in another tab).
watch(show, (open) => {
  if (open) {
    statusLoaded.value = false
    statusResource.fetch()
    // Reset toggle/touched state so previous-session overrides don't leak.
    includeSignals.value = false
    includeCompany.value = false
    signalsTouched.value = false
    companyTouched.value = false
  }
})

const defaults = computed(() => status.value.defaults || {})

const canEnrich = computed(
  () => status.value.enabled && status.value.configured,
)

const isAdmin = computed(() => status.value.role_ok)

// Disabled-state copy. Different message depending on what's wrong:
//   - Settings disabled                 → "ask admin to enable"
//   - Settings enabled but no api_key   → "ask admin to enter the API key"
//   - Caller has no role                → "ask admin for access"
const disabledTitle = computed(() => {
  if (!status.value.role_ok) return __('No access')
  if (!status.value.configured) return __('LinkedIn Questor not configured')
  return __('LinkedIn Questor is disabled')
})
const disabledBody = computed(() => {
  if (!status.value.role_ok) {
    return __(
      'Your account does not have the Autoklose User role. ' +
        'Ask an admin to grant it before enriching leads.',
    )
  }
  if (!status.value.configured) {
    return __(
      'The LinkedIn Questor API key is not set. Open LinkedIn Questor ' +
        'Settings to configure it (or set the LINKEDIN_QUESTOR_API_KEY ' +
        'env var on the server).',
    )
  }
  return __(
    'The integration is currently disabled. Open LinkedIn Questor ' +
      'Settings and flip Enabled on to allow enrichment calls.',
  )
})

// ─── Toggle state ────────────────────────────────────────────────────
const includeSignals = ref(false)
const includeCompany = ref(false)
const signalsTouched = ref(false)
const companyTouched = ref(false)

watch(includeSignals, (_, old) => {
  // ref starts at false; watcher fires once on init for that value if
  // we change it programmatically. Only mark touched on a real change
  // away from the initial value.
  if (signalsTouched.value || _ !== old) signalsTouched.value = true
})
watch(includeCompany, (_, old) => {
  if (companyTouched.value || _ !== old) companyTouched.value = true
})

// ─── Reactive credit estimate (P1 #5) ────────────────────────────────
// Per-Lead cost depends on the RESOLVED include_* values, which are
// the touched override OR the Settings default if untouched. We assume
// worst case for skills + certs (the bulk modal doesn't expose toggles
// for them; per-Lead overrides via the Dropdown still apply on the
// per-Lead button, but the bulk path inherits Settings defaults).
const estimatedCredits = computed(() => {
  const costs = status.value.credit_costs || {}
  const d = defaults.value

  // Resolve effective values.
  const wantSignals = signalsTouched.value ? includeSignals.value : !!d.include_signals
  const wantCompany = companyTouched.value ? includeCompany.value : !!d.include_company
  const wantSkills = !!d.include_skills
  const wantCerts = !!d.include_certifications

  // Build per-Lead cost.
  let perLead = costs.profile_base ?? 1.0
  if (wantSkills) perLead += costs.profile_skills ?? 0.5
  if (wantCerts) perLead += costs.profile_certs ?? 0.5
  if (wantSignals) perLead += costs.signals_total ?? 4.0
  if (wantCompany) perLead += costs.company ?? 1.0

  const total = perLead * selectionsCount.value
  // Show with up to 1 decimal but trim ".0" for integer totals.
  return Number.isInteger(total) ? String(total) : total.toFixed(1)
})

// ─── Dialog actions (reactive — disabled/enabled state) ─────────────
const dialogActions = computed(() => {
  // While status is still loading, only show Cancel — don't expose an
  // Enrich CTA the admin could click before the gate state is known.
  if (!statusLoaded.value) {
    return [{ label: __('Cancel') }]
  }
  if (!canEnrich.value) {
    if (isAdmin.value) {
      return [
        {
          label: __('Open Settings'),
          variant: 'solid',
          theme: 'blue',
          onClick: () => {
            // Open Desk Settings in a new tab — admin's session is
            // shared so they're already logged in.
            window.open('/app/linkedin-questor-settings', '_blank', 'noopener')
          },
        },
        { label: __('Close') },
      ]
    }
    return [{ label: __('Close') }]
  }
  return [
    {
      label: __('Enrich {0} leads', [selectionsCount.value]),
      variant: 'solid',
      theme: 'blue',
      loading: enriching.value,
      onClick: runBulk,
    },
    { label: __('Cancel') },
  ]
})

// ─── Action ──────────────────────────────────────────────────────────
const enriching = ref(false)
async function runBulk(close) {
  // Defense-in-depth: even though the CTA is hidden in the disabled
  // path, an admin could theoretically race a click during a state
  // change. Re-check before firing.
  if (!canEnrich.value) return
  const ids =
    props.selections instanceof Set
      ? Array.from(props.selections)
      : Array.isArray(props.selections)
        ? props.selections
        : Object.keys(props.selections || {})
  if (!ids.length) return
  enriching.value = true
  try {
    const payload = { lead_names: ids }
    if (signalsTouched.value) payload.include_signals = includeSignals.value
    if (companyTouched.value) payload.include_company = includeCompany.value
    const resp = await call(
      'firmadapt_crm.integrations.linkedin_questor.api.bulk_enrich_leads',
      payload,
    )
    emit('done', resp)
    close?.()
  } catch (e) {
    emit('done', {
      ok: [],
      failed: ids.map((lead) => ({
        lead,
        reason: e?.messages?.join(', ') || e?.message || 'Network error',
      })),
      total: ids.length,
    })
    close?.()
  } finally {
    enriching.value = false
  }
}

// Test affordances.
defineExpose({
  status,
  canEnrich,
  estimatedCredits,
  defaults,
})
</script>
