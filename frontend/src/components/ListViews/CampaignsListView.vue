<template>
  <ListView
    :class="$attrs.class"
    :columns="columns"
    :rows="rows"
    :options="{
      getRowRoute: (row) => ({
        name: 'Campaign',
        params: { campaignId: row.name },
      }),
      selectable: options.selectable,
      showTooltip: options.showTooltip,
      resizeColumn: options.resizeColumn,
    }"
    row-key="name"
    @update:selections="(selections) => emit('selectionsChanged', selections)"
  >
    <ListHeader
      class="sm:mx-5 mx-3"
      @columnWidthUpdated="emit('columnWidthUpdated')"
    >
      <ListHeaderItem
        v-for="column in columns"
        :key="column.key"
        :item="column"
        @columnWidthUpdated="emit('columnWidthUpdated', column)"
      />
    </ListHeader>
    <ListRows
      :rows="rows"
      v-slot="{ idx, column, item, row }"
      :options="{
        getRowRoute: (row) => ({
          name: 'Campaign',
          params: { campaignId: row.name },
        }),
        rowCount: options.rowCount,
        totalCount: options.totalCount,
      }"
      doctype="Autoklose Campaign"
    >
      <ListRowItem
        :item="item"
        :align="column.align"
        class="overflow-hidden"
      >
        <template #prefix>
          <div v-if="column.key === 'status'">
            <IndicatorIcon :class="getStatusColor(item)" />
          </div>
        </template>
        <template #default="{ label }">
          <div
            v-if="['modified', 'creation'].includes(column.key)"
            class="truncate text-base"
            @click="
              (event) =>
                emit('applyFilter', {
                  event,
                  idx,
                  column,
                  item,
                  firstColumn: columns[0],
                })
            "
          >
            <Tooltip :text="item.label">
              <div>{{ item.timeAgo }}</div>
            </Tooltip>
          </div>
          <div
            v-else-if="column.key === 'stats_recipients_total'"
            class="truncate text-base"
            @click="
              (event) =>
                emit('applyFilter', {
                  event,
                  idx,
                  column,
                  item,
                  firstColumn: columns[0],
                })
            "
          >
            {{ formatRecipientCount(item) }}
          </div>
          <div
            v-else-if="label"
            class="truncate text-base"
            @click="
              (event) =>
                emit('applyFilter', {
                  event,
                  idx,
                  column,
                  item,
                  firstColumn: columns[0],
                })
            "
          >
            {{ label }}
          </div>
        </template>
      </ListRowItem>
    </ListRows>
    <ListSelectBanner>
      <template #actions="{ unselectAll }">
        <Button
          variant="ghost"
          :label="__('Clear selection')"
          @click="unselectAll"
        />
      </template>
    </ListSelectBanner>
  </ListView>
</template>

<script setup>
// Explicit imports are required (not auto-imports) because the app-level
// ListRows wrapper in @/components/ListViews/ListRows.vue shares a name
// with frappe-ui's own ListRows export. unplugin-vue-components silently
// resolves naming conflicts by ignoring one — without this explicit
// import the wrapper gets dropped, frappe-ui's row-less ListRows is used
// instead, and the slot content replaces the v-for fallback (no rows
// render). Mirror of the LeadsListView import block.
import IndicatorIcon from '@/components/Icons/IndicatorIcon.vue'
import ListRows from '@/components/ListViews/ListRows.vue'
import {
  ListView,
  ListHeader,
  ListHeaderItem,
  ListSelectBanner,
  ListRowItem,
  Tooltip,
} from 'frappe-ui'
import { parseColor } from '@/utils'
import { useRoute } from 'vue-router'

defineProps({
  rows: { type: Array, required: true },
  columns: { type: Array, required: true },
  options: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'loadMore',
  'columnWidthUpdated',
  'applyFilter',
  'applyLikeFilter',
  'likeDoc',
  'selectionsChanged',
])

const route = useRoute()

// Mirror of the Frappe Desk badge mapping (autoklose_campaign_list.js).
// Keep in sync if a new Autoklose status appears.
//
// Module 2: added `in_progress` (the API's documented running label) and
// `pending` (transitional). `in_progress` shares the running-state green
// with the older `active` label that the /campaigns list endpoint returns.
const STATUS_COLOR = {
  active: 'green',
  in_progress: 'green',
  pending: 'orange',
  paused: 'orange',
  draft: 'gray',
  finished: 'blue',
  archived: 'gray',
}

// IndicatorIcon's stroke="currentColor" — needs a Tailwind text-color
// class (e.g. !text-orange-600). parseColor() turns the raw status
// color name into that class. Without parseColor, IndicatorIcon
// inherits the parent text color and all dots paint dark.
// (KanbanView wraps with parseColor itself; LeadsListView's status
// colors come pre-parsed from the statuses store. Our inline path
// has to do the parse explicitly.)
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
</script>
