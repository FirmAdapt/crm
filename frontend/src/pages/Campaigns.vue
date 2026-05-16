<template>
  <LayoutHeader>
    <template #left-header>
      <ViewBreadcrumbs v-model="viewControls" routeName="Campaigns" />
    </template>
    <!-- Module 3b — admins can now create a new Autoklose campaign from
         the CRM. Non-admins still see the read-only mirror only. The
         Autoklose Campaign doctype itself remains read_only at the
         field level (everything except the rows we author here is
         populated by the sync engine); the create path POSTs to
         Autoklose's `/api/campaigns` endpoint and re-syncs. -->
    <template v-if="autokloseAdminFlag" #right-header>
      <Button
        variant="solid"
        theme="blue"
        icon-left="plus"
        :label="__('Create')"
        @click="openCreateModal"
      />
    </template>
  </LayoutHeader>

  <!-- Mounted at the top level so closing + reopening within a session
       doesn't lose form scaffolding state. -->
  <CampaignCreateModal
    v-if="showCreateModal"
    v-model="showCreateModal"
    @created="onCampaignCreated"
  />

  <!-- Status chip filter row (decision B). Mirrors the colored badges used
       in both the Frappe Desk list (autoklose_campaign_list.js) and the
       CampaignsListView per-row badge. Click toggles a filter on the
       Status column via ViewControls; clicking the same chip again clears
       it. The chip set is hardcoded against the doctype's Select options
       so a new Autoklose status would require adding it here. -->
  <div
    class="flex items-center gap-2 border-b px-3 py-2 sm:px-5 overflow-x-auto"
  >
    <!-- Always render Badge in `subtle` variant — using `solid` on gray
         themes renders near-black (frappe-ui's solid gray is gray-900),
         which made the Draft/Archived chips look broken when active.
         The active state is communicated via an outline ring instead;
         consistent visual treatment across all five status colors. -->
    <Badge
      v-for="opt in STATUS_CHIPS"
      :key="opt.value"
      :label="__(opt.label)"
      :theme="opt.theme"
      variant="subtle"
      size="md"
      class="cursor-pointer flex-shrink-0 transition-shadow"
      :class="
        statusFilter === opt.value
          ? 'ring-2 ring-offset-1 ring-ink-gray-7'
          : ''
      "
      @click="toggleStatusChip(opt.value)"
    />
    <Button
      v-if="statusFilter"
      variant="ghost"
      size="sm"
      :label="__('Clear')"
      iconLeft="x"
      @click="toggleStatusChip(null)"
    />
  </div>

  <ViewControls
    ref="viewControls"
    v-model="campaigns"
    v-model:loadMore="loadMore"
    v-model:resizeColumn="triggerResize"
    v-model:updatedPageCount="updatedPageCount"
    doctype="Autoklose Campaign"
    :options="{
      allowedViews: ['list', 'kanban'],
    }"
  />

  <!-- Loading shell while view-switch race resolves. ViewControls' route
       watcher fires reload() with empty filters before our chip-filter
       watcher gets a chance to re-apply the chip's status filter, so
       two POSTs end up in flight (empty + filtered). Whichever responds
       last paints the UI — list happens to win, kanban happens to lose
       and shows the unfiltered data. We guard render until the wire
       state matches our chip state, so the unfiltered response (which
       could land last) doesn't get bound to the user's view.

       Visual: inline spinner + status-aware copy ("Applying filter…"
       when a chip is active, "Loading campaigns…" otherwise) so the
       brief flicker (~80–100ms typical) reads as meaningful activity
       rather than a static stall. -->
  <div
    v-if="route.params.viewType == 'kanban' && !kanbanReady"
    class="flex h-full items-center justify-center"
  >
    <div class="flex items-center gap-2 text-sm text-ink-gray-5">
      <FeatherIcon name="loader" class="h-4 w-4 animate-spin" />
      <span>
        {{
          statusFilter
            ? __('Applying filter…')
            : __('Loading campaigns…')
        }}
      </span>
    </div>
  </div>
  <KanbanView
    v-else-if="route.params.viewType == 'kanban'"
    v-model="campaigns"
    :options="{
      getRoute: (row) => ({
        name: 'Campaign',
        params: { campaignId: row.name },
        query: { view: route.query.view, viewType: route.params.viewType },
      }),
    }"
    @update="(data) => viewControls.updateKanbanSettings(data)"
    @loadMore="(columnName) => viewControls.loadMoreKanban(columnName)"
  >
    <template #title="{ titleField, itemName }">
      <div class="flex items-center gap-2">
        <div v-if="titleField === 'status'">
          <IndicatorIcon :class="getStatusColor(getRow(itemName, titleField))" />
        </div>
        <div
          v-if="getRow(itemName, titleField).label"
          class="truncate text-base"
        >
          {{ getRow(itemName, titleField).label }}
        </div>
        <div v-else class="text-ink-gray-4">{{ __('No Title') }}</div>
      </div>
    </template>
    <template #fields="{ fieldName, itemName }">
      <div
        v-if="getRow(itemName, fieldName).label"
        class="truncate flex items-center gap-2"
      >
        <div v-if="fieldName === 'status'">
          <IndicatorIcon :class="getStatusColor(getRow(itemName, fieldName))" />
        </div>
        <div v-if="fieldName === 'stats_recipients_total'" class="truncate text-base">
          {{ formatRecipientCount(getRow(itemName, fieldName)) }} {{ __('recipients') }}
        </div>
        <div v-else class="truncate text-base">
          {{ getRow(itemName, fieldName).label }}
        </div>
      </div>
    </template>
  </KanbanView>

  <CampaignsListView
    v-else-if="campaigns.data && rows.length"
    ref="campaignsListView"
    v-model="campaigns.data.page_length_count"
    v-model:list="campaigns"
    :rows="rows"
    :columns="columns"
    :options="{
      showTooltip: false,
      resizeColumn: true,
      rowCount: campaigns.data.row_count,
      totalCount: campaigns.data.total_count,
    }"
    @loadMore="() => loadMore++"
    @columnWidthUpdated="() => triggerResize++"
    @updatePageCount="(count) => (updatedPageCount = count)"
    @applyFilter="(data) => viewControls.applyFilter(data)"
    @applyLikeFilter="(data) => viewControls.applyLikeFilter(data)"
    @likeDoc="(data) => viewControls.likeDoc(data)"
    @selectionsChanged="
      (selections) => viewControls.updateSelections(selections)
    "
  />
  <EmptyState
    v-else-if="campaigns.data && !rows.length"
    name="Campaigns"
    :icon="MegaphoneIcon"
  />
</template>

<script setup>
import MegaphoneIcon from '~icons/lucide/megaphone'
import ViewBreadcrumbs from '@/components/ViewBreadcrumbs.vue'
import IndicatorIcon from '@/components/Icons/IndicatorIcon.vue'
import LayoutHeader from '@/components/LayoutHeader.vue'
import CampaignsListView from '@/components/ListViews/CampaignsListView.vue'
import CampaignCreateModal from '@/components/Modals/CampaignCreateModal.vue'
import EmptyState from '@/components/ListViews/EmptyState.vue'
import KanbanView from '@/components/Kanban/KanbanView.vue'
import ViewControls from '@/components/ViewControls.vue'
import { Badge, Button, FeatherIcon, createResource, toast } from 'frappe-ui'
import { useStorage } from '@vueuse/core'
import { parseColor } from '@/utils'
import { useRoute, useRouter } from 'vue-router'
import { ref, computed, watch } from 'vue'

const route = useRoute()
const router = useRouter()

// Module 3b — Create button visibility + flow.
//
// Admin gate mirrors what the Campaign detail page uses (Module 2's
// cadence buttons + Refresh now). Backend enforces the same gate via
// `_autoklose_admin_or_throw`, so this is purely UX hiding.
const autokloseAdminFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_admin',
  auto: true,
  onSuccess: (v) => (autokloseAdminFlag.value = !!v),
  onError: () => (autokloseAdminFlag.value = false),
})

const showCreateModal = ref(false)
function openCreateModal() {
  showCreateModal.value = true
}
function onCampaignCreated(resp) {
  toast.create({
    message: __("Campaign '{0}' created.", [
      resp?.campaign_name || resp?.campaign_id || 'untitled',
    ]),
    type: 'success',
  })
  if (resp?.campaign_id) {
    // Hand off to the detail page so the admin can add sequence steps
    // immediately. The campaign starts in `draft` status; Module 2's
    // Start button will appear in the detail-page header.
    router.push({
      name: 'Campaign',
      params: { campaignId: resp.campaign_id },
    })
  } else {
    // Defensive fallback: refresh the list so the new row appears
    // even if we can't navigate (e.g. backend somehow returned no id
    // but did succeed at the upstream API).
    campaignsListView.value?.list?.reload?.()
  }
}

const campaignsListView = ref(null)
const campaigns = ref({})
const loadMore = ref(1)
const triggerResize = ref(1)
const updatedPageCount = ref(20)
const viewControls = ref(null)

// Status chip filter — mirrors the Desk list-view badge color map and the
// CampaignsListView per-row badge. Keep in sync with both if a new
// Autoklose status is introduced.
const STATUS_CHIPS = [
  { value: 'active',   label: 'Active',   theme: 'green'  },
  { value: 'paused',   label: 'Paused',   theme: 'orange' },
  { value: 'draft',    label: 'Draft',    theme: 'gray'   },
  { value: 'finished', label: 'Finished', theme: 'blue'   },
  { value: 'archived', label: 'Archived', theme: 'gray'   },
]

// Same map as Campaign.vue. `in_progress` is the documented Autoklose API
// "running" value (returned by /campaigns/{id}/status), `active` is what
// the /campaigns list endpoint returns for the same state. Map both
// identically so the row colors stay consistent regardless of which
// payload populated the cache. `pending` (provisional running) renders
// orange — same as paused — to make any in-flight state visibly
// distinct from confirmed-running.
const STATUS_COLOR = {
  active: 'green',
  in_progress: 'green',
  pending: 'orange',
  paused: 'orange',
  draft: 'gray',
  finished: 'blue',
  archived: 'gray',
}

// IndicatorIcon needs a Tailwind text-color class (parseColor turns
// 'orange' into '!text-orange-600'); without it, the icon inherits
// the parent text color and dots render dark. KanbanView's built-in
// header template already wraps with parseColor — only our custom
// kanban-card title/fields templates need this on top.
function getStatusColor(item) {
  const value = typeof item === 'object' ? item?.label : item
  return parseColor(STATUS_COLOR[value] || 'gray')
}

function formatRecipientCount(item) {
  const raw = typeof item === 'object' ? item?.label : item
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw ?? ''
  return n.toLocaleString()
}

// Chip state is held in localStorage so it survives the list↔kanban
// view-switch remount AND a full page reload. Tried URL-as-source-of-
// truth (?status=) but ViewControls re-initializes on route change with
// empty default filters, racing our re-application — non-deterministic
// 3-fetch sequence (paused → empty → paused) where the empty response
// sometimes wins the paint. localStorage avoids the route-change
// re-init entirely. Bookmark/shareable URLs would need a deeper hook
// into ViewControls' init path; tracked as a polish follow-up.
const statusFilter = useStorage('autoklose-campaigns-chip-status', null)

function toggleStatusChip(v) {
  statusFilter.value = statusFilter.value === v ? null : v
  applyChipFilter()
}

// Mutate campaigns.value.params.filters + reload — same pipeline the
// ViewControls in-row applyFilter / dropdown filter uses internally
// (see updateFilter() in ViewControls.vue line 833-859). The :filters
// prop on ViewControls is consumed once at view-init as default_filters
// and is NOT reactive, so we can't drive the chip from there.
function applyChipFilter() {
  const list = campaigns.value
  if (!list?.params) return
  const desired = statusFilter.value
  const current = list.params.filters?.status ?? null
  if (current === desired) return
  const filters = { ...(list.params.filters || {}) }
  if (desired) {
    filters.status = desired
  } else {
    delete filters.status
  }
  list.params.filters = filters
  list.reload?.()
}

// Re-apply the chip filter sequentially after any in-flight ViewControls
// fetch settles. Watching `loading` (not just `params`) keeps our
// re-reload from racing the view-init reload — when we mutate filters
// and reload while ViewControls' empty-filter request is still in
// flight, both responses end up bound to `data` non-deterministically
// (POST #1's late response can overwrite POST #2's correct one).
// Waiting for loading→false serializes them: ViewControls' empty
// request lands first → we then mutate filters and reload → ours lands
// last → kanban paints correctly. Idempotent (no-op when filter on the
// wire already matches the chip).
watch(
  [() => campaigns.value?.params, () => campaigns.value?.loading],
  () => {
    const list = campaigns.value
    if (!list?.params || !statusFilter.value) return
    if (list.loading) return
    if (list.params.filters?.status === statusFilter.value) return
    applyChipFilter()
  },
)

// True when the data currently bound to KanbanView reflects our chip
// filter. Used to gate the kanban render against the empty-filter
// response that races our chip-filter response on view-switch.
const kanbanReady = computed(() => {
  if (!statusFilter.value) return true
  if (!campaigns.value?.params || !campaigns.value?.data) return false
  // Loading flag means a request is in flight — wait for it to settle.
  if (campaigns.value.loading) return false
  return campaigns.value.params.filters?.status === statusFilter.value
})

function getRow(name, field) {
  function getValue(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value
    }
    return { label: value }
  }
  const row = rows.value?.find((r) => r.name == name)
  if (!row) return { label: '' }
  return getValue(row[field])
}

const rows = computed(() => {
  if (!campaigns.value?.data?.data) return []
  if (campaigns.value.data.view_type === 'kanban') {
    return getKanbanRows(campaigns.value.data.data, campaigns.value.data.fields)
  }
  return parseRows(campaigns.value?.data.data, campaigns.value.data.columns)
})

const columns = computed(() => {
  let _columns = campaigns.value?.data?.columns || []
  if (_columns.length) {
    _columns = _columns.map((col, index) =>
      index === _columns.length - 1 ? { ...col, align: 'right' } : col,
    )
  }
  return _columns
})

function getKanbanRows(data, _columns) {
  const _rows = []
  data.forEach((column) => {
    column.data?.forEach((row) => _rows.push(row))
  })
  return parseRows(_rows, _columns)
}

// Pre-set kanban column colors before KanbanView's computed runs its
// auto-color cycle (KanbanView only auto-assigns when no column has a
// color set — see Kanban/KanbanView.vue line 207-212). We map the
// status value to our STATUS_COLOR palette so paused renders orange,
// finished renders blue, etc. — matching the chip filter and Desk
// list-view badges. Without this the kanban headers fall back to a
// hash-cycle (paused=red, finished=pink) regardless of semantics.
//
// CRITICAL: must set color on EVERY column, not just matched ones. The
// kanban API includes a `name=""` placeholder column for rows with no
// status. If we only set colors for matched names, that empty column
// has `color=undefined` AND KanbanView's `has_color` becomes truthy
// (some columns are set), so the auto-cycle skips. The empty column
// then renders its header indicator with `!text-undefined-600` —
// parseColor(undefined). Falling back to 'gray' for any unmatched
// column keeps the kanban consistent.
watch(
  () => campaigns.value?.data,
  (data) => {
    if (!data || data.view_type !== 'kanban') return
    const cols = data.data
    if (!Array.isArray(cols)) return
    cols.forEach((c) => {
      if (!c.column) return
      c.column.color = STATUS_COLOR[c.column.name] || 'gray'
    })
  },
  { immediate: true, deep: false },
)

function parseRows(rawRows, _columns = []) {
  const view_type = campaigns.value.data.view_type
  const key = view_type === 'kanban' ? 'fieldname' : 'key'

  return rawRows.map((camp) => {
    const _rows = {}
    campaigns.value?.data.rows.forEach((row) => {
      _rows[row] = camp[row]
      if (row === 'status') {
        _rows[row] = {
          label: camp.status,
          color: STATUS_COLOR[camp.status] || 'gray',
        }
      } else if (row === 'stats_recipients_total') {
        _rows[row] = { label: camp.stats_recipients_total }
      }
    })
    return _rows
  })
}
</script>
