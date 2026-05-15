<template>
  <Dialog
    v-model="show"
    :options="{
      title: __('Push selected leads to Autoklose'),
      size: 'md',
      actions: [
        {
          label: __('Push to Autoklose'),
          variant: 'solid',
          theme: 'blue',
          loading: pushing,
          onClick: runPush,
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
              'Pushing {0} selected lead(s) to one Autoklose campaign. ' +
                'Leads without an email, frozen by a Lead Email Conflict, ' +
                'or not owned by you will be skipped — you can retry ' +
                'them individually afterwards.',
              [selectionsCount],
            )
          }}
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-ink-gray-9">
            {{ __('Campaign') }}
          </label>
          <!-- IMPORTANT: the local Autocomplete wrapper (@/components/
               frappe-ui/Autocomplete.vue) emits `update:modelValue`
               with the WHOLE option object — not just `.value` — when
               used via v-model. It emits `change` ONLY when bound via
               the `value` prop (not v-model). So we v-model to
               `selectedOption` (an object), and extract `.value` at
               POST time. Earlier attempt v-modeled to a string ref and
               listened to @change, which never fired and shipped the
               full dict to the backend (500 on `.strip()` of a dict). -->
          <Autocomplete
            v-model="selectedOption"
            :options="campaignOptions"
            :placeholder="__('Search campaigns…')"
          />
          <div
            v-if="selectedRow"
            class="mt-2 text-xs text-ink-gray-5"
          >
            <span class="font-medium">{{ __('Status') }}:</span>
            {{ selectedRow.status || '—' }}
            <span v-if="selectedRow.stats_recipients_total != null">
              · {{ __('Current recipients') }}:
              {{ selectedRow.stats_recipients_total }}
            </span>
          </div>
          <!-- The picker is filtered server-side to push-eligible statuses
               (active/in_progress/paused). Draft + finished + archived
               campaigns can't accept new recipients via the Autoklose
               API, so we hide them rather than letting the admin pick
               one and hit a 403 per lead. -->
          <div v-if="!campaignOptions.length" class="mt-2 text-xs text-ink-amber-7">
            {{
              __(
                'No push-eligible campaigns visible. ' +
                  'Campaigns must be active, in_progress, or paused — ' +
                  'and you only see ones with recipients you own.',
              )
            }}
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import Autocomplete from '@/components/frappe-ui/Autocomplete.vue'
import { Dialog, call, createListResource } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

// Removed `chosenCampaignName` / `chosen` refs; replaced by
// `selectedOption` (full object) + `selectedRow` + `selectedId`
// computeds. See the comment block inside the template for the
// reasoning around v-model vs @change on the Autocomplete wrapper.

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

// Push-eligible campaigns only. Per Autoklose docs, draft / finished /
// archived all 403 on POST /recipients — surfacing them in the picker
// would just produce a wall of per-lead failures. The Pattern A row-
// visibility filter ALSO applies (the user sees only campaigns whose
// recipients map to their leads), so the result set is naturally
// scoped to "campaigns this user can already work with."
// pageLength sized for "every push-eligible campaign the user could
// pick in one sitting." Pattern A scopes this list to campaigns whose
// recipients map to leads the caller owns, so the per-user upper
// bound is naturally small. But on a multi-admin prod cache (e.g. the
// dev cache already crosses 135 eligible campaigns), 100 leaves
// alphabetically-late campaigns invisible to the Autocomplete's
// client-side filter — surfaced by the Playwright bulk-push spec.
// 1000 covers every realistic case without paying the engineering
// cost of server-side search-as-you-type, which would be the more
// robust solution at scale.
const campaignList = createListResource({
  doctype: 'Autoklose Campaign',
  fields: ['name', 'campaign_name', 'status', 'stats_recipients_total'],
  filters: {
    status: ['in', ['active', 'in_progress', 'paused']],
  },
  orderBy: 'campaign_name asc',
  pageLength: 1000,
  auto: true,
})

const campaignOptions = computed(() => {
  return (campaignList.data || []).map((c) => ({
    label: c.campaign_name || c.name,
    value: c.name,
    description: c.status,
    // Raw row kept on the option so we can show the status + recipient
    // count below the picker without a second fetch.
    _row: c,
  }))
})

// Full option object (or null) the Autocomplete v-models against.
// Shape: { label, value, description, _row, ... }. We never read its
// content blindly — see selectedRow + selectedId below.
const selectedOption = ref(null)

// Raw Autoklose Campaign row pulled from the option's `_row` key.
// Used for the inline "Status: … · Current recipients: …" helper.
const selectedRow = computed(() => selectedOption.value?._row || null)

// Bare campaign id string for the backend POST. Backend additionally
// hardens against accidental dict input via `_coerce_id`, but we
// extract here so the success path doesn't even hit that defensive
// branch.
const selectedId = computed(() => selectedOption.value?.value || '')

const pushing = ref(false)
async function runPush(close) {
  const cid = selectedId.value
  if (!cid) return
  const ids = props.selections instanceof Set
    ? Array.from(props.selections)
    : Array.isArray(props.selections)
      ? props.selections
      : Object.keys(props.selections || {})
  if (!ids.length) return
  pushing.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.autoklose.api.bulk_push_leads',
      {
        lead_names: ids,
        campaign_id: cid,
      },
    )
    emit('done', resp)
    close?.()
  } catch (e) {
    // Errors are surfaced by the parent (ListBulkActions) via the
    // 'done' handler's toast path, but if call() itself throws
    // (network, etc.) we still want feedback.
    emit('done', {
      campaign_id: cid,
      ok: [],
      failed: ids.map((lead) => ({
        lead,
        reason:
          e?.messages?.join(', ') ||
          e?.message ||
          'Network error',
      })),
      total: ids.length,
    })
    close?.()
  } finally {
    pushing.value = false
  }
}

// Reset when reopened.
watch(show, (open) => {
  if (open) {
    selectedOption.value = null
  }
})
</script>
