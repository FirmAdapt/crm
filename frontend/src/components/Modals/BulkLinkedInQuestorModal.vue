<template>
  <!--
    FirmAdapt Module LinkedIn Questor — bulk enrichment modal.

    Mirrors PushToAutokloseModal: a single confirm dialog with the
    selection count, the worst-case credit cost, and a pair of toggles
    for the two flags most worth surfacing at the bulk level (signals +
    company data). Skills / certifications are left at the Settings
    default to keep the modal scannable.

    On confirm: POSTs to
      firmadapt_crm.integrations.linkedin_questor.api.bulk_enrich_leads
    with `{lead_names, include_signals?, include_company?}`. Emits
    `done(resp)` to the parent (ListBulkActions.vue), which renders the
    result toast and reloads the list.

    Worst-case credit cost per Lead is documented in Settings:
      profile 1.5 + open_to_work 1 + open_profile 1 + recent_activity 2
      + company 1 + cert 0.5 = 7 credits / Lead.

    The actual cost is usually lower (Settings defaults turn some
    sub-calls off, e.g. include_signals_default=0). We compute the
    worst case so admins don't blow through monthly budget by accident.
  -->
  <Dialog
    v-model="show"
    :options="{
      title: __('Enrich selected leads from LinkedIn'),
      size: 'md',
      actions: [
        {
          label: __('Enrich {0} leads', [selectionsCount]),
          variant: 'solid',
          theme: 'blue',
          loading: enriching,
          onClick: runBulk,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <div class="space-y-4">
        <div class="text-sm text-ink-gray-7">
          {{
            __(
              'LinkedIn Questor will fetch each Lead\'s LinkedIn profile ' +
                'and fill empty CRM fields (existing values are never ' +
                'overwritten). Leads without a LinkedIn URL are skipped ' +
                'server-side without burning credits. Worst-case cost: ' +
                '{0} × 7 = {1} credits.',
              [selectionsCount, worstCaseCredits],
            )
          }}
        </div>

        <div class="space-y-2 rounded border border-outline-gray-2 p-3">
          <div class="flex items-center justify-between text-sm">
            <label class="text-ink-gray-8">{{ __('Include signals') }}</label>
            <Switch v-model="includeSignals" />
          </div>
          <div class="flex items-center justify-between text-sm">
            <label class="text-ink-gray-8">{{ __('Include company data') }}</label>
            <Switch v-model="includeCompany" />
          </div>
          <div class="pt-1 text-xs text-ink-gray-5">
            {{
              __(
                'Skills + certifications use the LinkedIn Questor Settings ' +
                  'defaults. Toggle the per-Lead Dropdown on the Lead ' +
                  'detail page to override those.',
              )
            }}
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Dialog, Switch, call } from 'frappe-ui'
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

const worstCaseCredits = computed(() => selectionsCount.value * 7)

// Both flags start at the Settings default (we represent that as
// "leave the key off the payload"). Once the user clicks the Switch
// they've committed to an explicit override — track that with a
// "touched" flag per switch so we only send the keys they actually
// touched. (Sending include_signals=false when they never toggled it
// would clobber a Settings default of true.)
const includeSignals = ref(false)
const includeCompany = ref(false)
const signalsTouched = ref(false)
const companyTouched = ref(false)

watch(includeSignals, () => (signalsTouched.value = true))
watch(includeCompany, () => (companyTouched.value = true))

const enriching = ref(false)
async function runBulk(close) {
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

// Reset toggles + touched state when the modal reopens. Otherwise a
// previous bulk's "I touched the switch" state leaks into the next
// one and we'd send unintended overrides.
watch(show, (open) => {
  if (open) {
    includeSignals.value = false
    includeCompany.value = false
    signalsTouched.value = false
    companyTouched.value = false
  }
})
</script>
