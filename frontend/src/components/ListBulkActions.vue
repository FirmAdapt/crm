<template>
  <EditValueModal
    v-if="showEditModal"
    v-model="showEditModal"
    :doctype="doctype"
    :selectedValues="selectedValues"
    @reload="reload"
  />
  <AssignmentModal
    v-if="showAssignmentModal"
    v-model="showAssignmentModal"
    v-model:assignees="bulkAssignees"
    :docs="selectedValues"
    :doctype="doctype"
    @reload="reload"
  />
  <DeleteLinkedDocModal
    v-if="showDeleteDocModal.showLinkedDocsModal"
    v-model="showDeleteDocModal.showLinkedDocsModal"
    :doctype="props.doctype"
    :docname="showDeleteDocModal.docname"
    :reload="reload"
  />
  <BulkDeleteLinkedDocModal
    v-if="showDeleteDocModal.showDeleteModal"
    v-model="showDeleteDocModal.showDeleteModal"
    :doctype="props.doctype"
    :items="showDeleteDocModal.items"
    :reload="reload"
  />
  <!-- Module 6: bulk Push-to-Autoklose modal lives here because it
       belongs to the CRM Lead bulk-action surface; mounting it inside
       the action callback would re-create on every open. -->
  <PushToAutokloseModal
    v-if="showPushToAutokloseModal"
    v-model="showPushToAutokloseModal"
    :selections="pushSelections"
    @done="onPushToAutokloseDone"
  />
</template>

<script setup>
import EditValueModal from '@/components/Modals/EditValueModal.vue'
import AssignmentModal from '@/components/Modals/AssignmentModal.vue'
import PushToAutokloseModal from '@/components/Modals/PushToAutokloseModal.vue'
import { setupListCustomizations } from '@/utils'
import { globalStore } from '@/stores/global'
import { useTelemetry } from 'frappe-ui/frappe'
import { call, toast } from 'frappe-ui'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  doctype: { type: String, default: '' },
  options: {
    type: Object,
    default: () => ({
      hideEdit: false,
      hideDelete: false,
      hideAssign: false,
    }),
  },
})

const list = defineModel({ type: Object })

const router = useRouter()

const { $dialog, $socket } = globalStore()
const { capture } = useTelemetry()

const showEditModal = ref(false)
const selectedValues = ref([])
const unselectAllAction = ref(() => {})
const showDeleteDocModal = ref({
  showLinkedDocsModal: false,
  showDeleteModal: false,
  docname: null,
})
function editValues(selections, unselectAll) {
  selectedValues.value = selections
  showEditModal.value = true
  unselectAllAction.value = unselectAll
}

function convertToDeal(selections, unselectAll) {
  $dialog({
    title: __('Convert to Deal'),
    message: __('Are you sure you want to convert {0} lead(s) to deal(s)?', [
      selections.size,
    ]),
    variant: 'solid',
    theme: 'blue',
    actions: [
      {
        label: __('Convert'),
        variant: 'solid',
        onClick: (close) => {
          capture('bulk_convert_to_deal')
          Array.from(selections).forEach((name) => {
            call('crm.fcrm.doctype.crm_lead.crm_lead.convert_to_deal', {
              lead: name,
            }).then(() => {
              toast.success(__('Converted Successfully'))
              list.value.reload()
              unselectAll()
              close()
            })
          })
        },
      },
    ],
  })
}

function deleteValues(selections, unselectAll) {
  unselectAllAction.value = unselectAll

  const selectedDocs = Array.from(selections)
  if (selectedDocs.length == 1) {
    showDeleteDocModal.value = {
      showLinkedDocsModal: true,
      docname: selectedDocs[0],
    }
  } else {
    showDeleteDocModal.value = {
      showDeleteModal: true,
      items: selectedDocs,
    }
  }
}

const showAssignmentModal = ref(false)
const bulkAssignees = ref([])

function assignValues(selections, unselectAll) {
  showAssignmentModal.value = true
  selectedValues.value = selections
  unselectAllAction.value = unselectAll
}

function clearAssignments(selections, unselectAll) {
  $dialog({
    title: __('Clear Assignment'),
    message: __('Are you sure you want to clear assignment for {0} item(s)?', [
      selections.size,
    ]),
    variant: 'solid',
    theme: 'red',
    actions: [
      {
        label: __('Clear Assignment'),
        variant: 'solid',
        theme: 'red',
        onClick: (close) => {
          capture('bulk_clear_assignment')
          call('frappe.desk.form.assign_to.remove_multiple', {
            doctype: props.doctype,
            names: JSON.stringify(Array.from(selections)),
            ignore_permissions: true,
          }).then(() => {
            toast.success(__('Assignment Cleared Successfully'))
            reload(unselectAll)
            close()
          })
        },
      },
    ],
  })
}

// ---- Module 6 (Autoklose bulk actions) ------------------------------------
//
// Both helpers below show a $dialog confirm, call the corresponding
// whitelisted backend with the selected ids, and surface a results toast
// summarizing ok/failed counts. The Push-to-Autoklose flow has an extra
// step: the admin picks a target campaign in a separate
// PushToAutokloseModal before the confirm fires.

const showPushToAutokloseModal = ref(false)
const pushSelections = ref(null)
const pushUnselectAll = ref(() => {})

function bulkCadence(selections, unselectAll, opts) {
  const ids = Array.from(selections)
  if (!ids.length) return
  $dialog({
    title: opts.dialogTitle,
    message: opts.dialogBody + '\n\n' + __('Selected: {0}', [ids.length]),
    variant: 'solid',
    theme: opts.ctaTheme,
    actions: [
      {
        label: opts.ctaLabel,
        variant: 'solid',
        theme: opts.ctaTheme,
        onClick: (close) => {
          capture('autoklose_bulk_cadence', { target: opts.target })
          call(
            'firmadapt_crm.integrations.autoklose.api.bulk_set_campaign_status',
            { campaign_ids: ids, status: opts.target },
          )
            .then((resp) => {
              renderBulkCadenceResult(resp, opts.successPrefix)
              list.value?.reload()
              unselectAll()
              close()
            })
            .catch((e) => {
              toast.create({
                message:
                  e?.messages?.join(', ') ||
                  e?.message ||
                  __('Bulk action failed.'),
                type: 'error',
              })
            })
        },
      },
      // Explicit Cancel button matches the per-campaign Cadence dialogs
      // on the detail page (Module 2). Without it the only escape is
      // the top-right ✕ icon — usable but inconsistent with the rest
      // of the cadence UX.
      { label: __('Cancel') },
    ],
  })
}

function renderBulkCadenceResult(resp, successPrefix) {
  const okCount = resp?.ok?.length ?? 0
  const failed = resp?.failed ?? []
  if (failed.length === 0) {
    toast.create({
      message: __('{0} {1} campaign(s).', [successPrefix, okCount]),
      type: 'success',
    })
    return
  }
  // Mixed result — show ok + failed counts in the toast. Per-id error
  // detail goes to the console (full structured) so an admin can grep
  // for the specific failing campaign id rather than parsing a tiny
  // toast. Same pattern as Frappe's own bulk operation feedback.
  const failedSummary = failed
    .slice(0, 3)
    .map((f) => `${f.id}: ${f.reason}`)
    .join(' · ')
  const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : ''
  toast.create({
    message: __(
      '{0} {1} ok, {2} skipped. {3}{4}',
      [successPrefix, okCount, failed.length, failedSummary, more],
    ),
    type: okCount > 0 ? 'warning' : 'error',
  })
  // eslint-disable-next-line no-console
  console.warn('[bulk_set_campaign_status] failed entries:', failed)
}

function pushToAutoklose(selections, unselectAll) {
  pushSelections.value = selections
  pushUnselectAll.value = unselectAll
  showPushToAutokloseModal.value = true
}

// ---- Module Vayne (bulk LinkedIn enrichment) ------------------------------
//
// Async via /api/linkedin_scrapings/batch. Confirm dialog quotes the
// worst-case credit cost (N × 16) so admins don't burn through the
// monthly budget by accident. The actual cost can be lower if some
// leads have no LinkedIn URL — those are skipped server-side without
// burning credits. The webhook handler ingests results and writes
// audit rows per Lead 1–5 minutes later; we don't block on it here.
function enrichFromLinkedin(selections, unselectAll) {
  const ids = Array.from(selections)
  if (!ids.length) return
  // Worst-case estimate: 16 credits per profile (with company details).
  // Vayne returns the true `credits_used` in the batch response, which
  // we surface in the post-call toast.
  const worstCaseCredits = ids.length * 16
  $dialog({
    title: __('Enrich {0} lead(s) from LinkedIn?', [ids.length]),
    message: __(
      'Vayne will fetch the LinkedIn profile for each selected Lead and ' +
        'fill empty CRM fields (existing values are never overwritten). ' +
        'Leads without a LinkedIn URL will be skipped. ' +
        'Estimated cost: up to {0} × 16 = {1} credits. Results land in ' +
        '1–5 minutes via webhook.',
      [ids.length, worstCaseCredits],
    ),
    variant: 'solid',
    theme: 'blue',
    actions: [
      {
        label: __('Submit batch'),
        variant: 'solid',
        theme: 'blue',
        onClick: (close) => {
          capture('vayne_bulk_enrich')
          call(
            'firmadapt_crm.integrations.vayne.api.bulk_enrich_leads',
            { lead_names: ids },
          )
            .then((resp) => {
              renderBulkEnrichResult(resp)
              list.value?.reload()
              unselectAll()
              close()
            })
            .catch((e) => {
              toast.create({
                message:
                  e?.messages?.join(', ') ||
                  e?.message ||
                  __('Bulk enrich failed.'),
                type: 'error',
              })
            })
        },
      },
      { label: __('Cancel') },
    ],
  })
}

function renderBulkEnrichResult(resp) {
  const queued = resp?.leads_with_url?.length ?? 0
  const skipped = resp?.leads_without_url ?? []
  const creditsUsed = resp?.credits_used ?? 0
  if (skipped.length === 0) {
    toast.create({
      message: __(
        'Batch submitted — {0} profile(s) queued for enrichment. ' +
          '{1} credit(s) reserved. Results in 1–5 minutes.',
        [queued, creditsUsed],
      ),
      type: 'success',
    })
    return
  }
  const failedSummary = skipped
    .slice(0, 3)
    .map((f) => `${f.lead}: ${f.reason}`)
    .join(' · ')
  const more = skipped.length > 3 ? ` (+${skipped.length - 3} more)` : ''
  toast.create({
    message: __(
      'Batch submitted — {0} queued, {1} skipped. {2} credit(s) reserved. ' +
        '{3}{4}',
      [queued, skipped.length, creditsUsed, failedSummary, more],
    ),
    type: queued > 0 ? 'warning' : 'error',
  })
  // eslint-disable-next-line no-console
  console.warn('[bulk_enrich_leads] skipped entries:', skipped)
}

// ---- Module BetterEnrich (bulk work-email find) ---------------------------
//
// BetterEnrich exposes per-user, per-hour and per-day quotas. The bulk
// flow is sync (each lookup is small + cheap-ish), but the server may
// rate-limit individual entries mid-batch. The response carries three
// disjoint buckets:
//   - ok:           [{lead, usage_log_name}]
//   - rate_limited: [{lead, reason}]
//   - failed:       [{lead, reason}] — missing prerequisites etc.
// We surface the three counts in a single toast and dump the per-id
// detail to the console for grep-ability (same shape as Vayne bulk).
function bulkBetterEnrichWorkEmail(selections, unselectAll) {
  const ids = Array.from(selections)
  if (!ids.length) return
  $dialog({
    title: __('Find work emails for {0} lead(s)?', [ids.length]),
    message: __(
      'BetterEnrich will look up a work email for each selected Lead. ' +
        'Estimated worst-case cost: {0} × 1 = {1} email credit(s). The ' +
        'call also consumes your hourly + daily BetterEnrich quota — any ' +
        'leads beyond your remaining quota will be marked rate-limited. ' +
        'Leads missing prerequisites (name / company website) will be ' +
        'skipped without burning credits.',
      [ids.length, ids.length],
    ),
    variant: 'solid',
    theme: 'blue',
    actions: [
      {
        label: __('Run BetterEnrich'),
        variant: 'solid',
        theme: 'blue',
        onClick: (close) => {
          capture('betterenrich_bulk_find_work_email')
          call(
            'firmadapt_crm.integrations.betterenrich.api.bulk_find_work_email',
            { lead_names: ids },
          )
            .then((resp) => {
              renderBulkBetterEnrichResult(resp)
              list.value?.reload()
              unselectAll()
              close()
            })
            .catch((e) => {
              toast.create({
                message:
                  e?.messages?.join(', ') ||
                  e?.message ||
                  __('BetterEnrich bulk call failed.'),
                type: 'error',
              })
            })
        },
      },
      { label: __('Cancel') },
    ],
  })
}

function renderBulkBetterEnrichResult(resp) {
  const ok = resp?.ok?.length ?? 0
  const rateLimited = resp?.rate_limited?.length ?? 0
  const failed = resp?.failed?.length ?? 0
  const summary = __(
    'BetterEnrich: {0} submitted, {1} rate-limited, {2} failed (no prerequisites)',
    [ok, rateLimited, failed],
  )
  if (rateLimited === 0 && failed === 0) {
    toast.create({ message: summary, type: 'success' })
    return
  }
  toast.create({
    message: summary,
    type: ok > 0 ? 'warning' : 'error',
  })
  // Surface per-id detail for admin debugging — mirrors Vayne /
  // Autoklose bulk toasts.
  // eslint-disable-next-line no-console
  console.warn('[bulk_find_work_email] details:', {
    rate_limited: resp?.rate_limited ?? [],
    failed: resp?.failed ?? [],
  })
}

function onPushToAutokloseDone(resp) {
  // Modal calls $emit('done', resp) after the backend returns. resp
  // is the bulk_push_leads payload {ok: [...], failed: [...], total}.
  const okCount = resp?.ok?.length ?? 0
  const failed = resp?.failed ?? []
  if (failed.length === 0) {
    toast.create({
      message: __('Pushed {0} lead(s) to Autoklose.', [okCount]),
      type: 'success',
    })
  } else {
    const failedSummary = failed
      .slice(0, 3)
      .map((f) => `${f.lead}: ${f.reason}`)
      .join(' · ')
    const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : ''
    toast.create({
      message: __(
        'Pushed {0} ok, {1} skipped. {2}{3}',
        [okCount, failed.length, failedSummary, more],
      ),
      type: okCount > 0 ? 'warning' : 'error',
    })
    // eslint-disable-next-line no-console
    console.warn('[bulk_push_leads] failed entries:', failed)
  }
  list.value?.reload()
  pushUnselectAll.value?.()
  showPushToAutokloseModal.value = false
}

const customBulkActions = ref([])
const customListActions = ref([])

function bulkActions(selections, unselectAll) {
  let actions = []

  if (!props.options.hideEdit) {
    actions.push({
      label: __('Edit'),
      onClick: () => editValues(selections, unselectAll),
    })
  }

  if (!props.options.hideDelete) {
    actions.push({
      label: __('Delete'),
      onClick: () => deleteValues(selections, unselectAll),
    })
  }

  if (!props.options.hideAssign) {
    actions.push({
      label: __('Assign To'),
      onClick: () => assignValues(selections, unselectAll),
    })
    actions.push({
      label: __('Clear Assignment'),
      onClick: () => clearAssignments(selections, unselectAll),
    })
  }

  if (props.doctype === 'CRM Lead') {
    actions.push({
      label: __('Convert to Deal'),
      onClick: () => convertToDeal(selections, unselectAll),
    })
    // Module 6 (Part B): bulk push selected leads into an Autoklose
    // campaign. Server enforces admin-or-Autoklose-user role + per-lead
    // ownership; we surface the action to anyone using the Leads list
    // since the role check at click time will produce the right error.
    actions.push({
      label: __('Push to Autoklose'),
      onClick: () => pushToAutoklose(selections, unselectAll),
    })
    // Module Vayne: bulk-enrich selected leads from LinkedIn via Vayne.
    // Same role + per-lead ownership gate as Push to Autoklose, enforced
    // server-side; same UX surface so admins find both actions next to
    // each other in the bulk dropdown.
    actions.push({
      label: __('Enrich from LinkedIn'),
      onClick: () => enrichFromLinkedin(selections, unselectAll),
    })
    // Module BetterEnrich: bulk work-email lookup. Distinct from Vayne
    // (which scrapes a LinkedIn profile in full); BetterEnrich just
    // returns the work email. Quota / rate-limit enforcement is server-
    // side — partial results come back in the response and we surface
    // ok / rate-limited / failed counts in a single toast.
    actions.push({
      label: __('Find work emails (BetterEnrich)'),
      onClick: () => bulkBetterEnrichWorkEmail(selections, unselectAll),
    })
  }

  // Module 6 (Part A): bulk Pause / Resume on Autoklose Campaign list.
  // Admin gate is also enforced server-side; the SPA hides the Dropdown
  // entirely for non-admins (CampaignsListView's autokloseAdminFlag),
  // so this branch is just the canonical wiring.
  if (props.doctype === 'Autoklose Campaign') {
    actions.push({
      label: __('Pause selected'),
      onClick: () =>
        bulkCadence(selections, unselectAll, {
          target: 'paused',
          dialogTitle: __('Pause selected campaigns?'),
          dialogBody: __(
            'Autoklose will stop sending emails for these campaigns. ' +
              'Campaigns not currently running will be skipped — you' +
              "'ll see a per-campaign result list below.",
          ),
          ctaLabel: __('Pause campaigns'),
          ctaTheme: 'red',
          successPrefix: __('Paused'),
        }),
    })
    actions.push({
      label: __('Resume selected'),
      onClick: () =>
        bulkCadence(selections, unselectAll, {
          target: 'in_progress',
          dialogTitle: __('Resume selected campaigns?'),
          dialogBody: __(
            'Autoklose will pick up sending where each campaign left ' +
              'off. Campaigns not currently paused (or draft) will be ' +
              "skipped — you'll see a per-campaign result list below.",
          ),
          ctaLabel: __('Resume campaigns'),
          ctaTheme: 'green',
          successPrefix: __('Resumed'),
        }),
    })
  }

  customBulkActions.value.forEach((action) => {
    actions.push({
      label: __(action.label),
      onClick: () =>
        action.onClick({
          list: list.value,
          selections,
          unselectAll,
          call,
          createToast: toast.create,
          toast,
          $dialog,
          router,
        }),
    })
  })
  return actions
}

function reload(unselectAll) {
  showDeleteDocModal.value = {
    showLinkedDocsModal: false,
    showDeleteModal: false,
    docname: null,
  }

  unselectAllAction.value?.()
  unselectAll?.()
  list.value?.reload()
}

onMounted(async () => {
  if (!list.value?.data) return
  let customization = await setupListCustomizations(list.value.data, {
    list: list.value,
    call,
    createToast: toast.create,
    toast,
    $dialog,
    $socket,
    router,
  })
  customBulkActions.value =
    customization?.bulkActions || list.value?.data?.bulkActions || []
  customListActions.value =
    customization?.actions || list.value?.data?.listActions || []
})

defineExpose({
  bulkActions,
  customListActions,
})
</script>
