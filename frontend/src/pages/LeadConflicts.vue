<template>
  <LayoutHeader>
    <template #left-header>
      <Breadcrumbs :items="breadcrumbs" />
    </template>
    <template #right-header>
      <Button
        :label="__('Refresh')"
        :iconLeft="'refresh-cw'"
        variant="subtle"
        @click="refresh"
      />
    </template>
  </LayoutHeader>

  <div v-if="!isAdmin" class="p-8 text-center text-ink-gray-7">
    {{
      __(
        'Only admins (System Manager, Sales Manager, Autoklose Admin) can view Lead Email Conflicts.',
      )
    }}
  </div>

  <div v-else class="flex h-full flex-col overflow-hidden">
    <!-- Filter bar -->
    <div class="flex items-center gap-3 border-b px-5 py-3">
      <div class="text-sm text-ink-gray-7">{{ __('Status') }}</div>
      <FormControl
        v-model="statusFilter"
        type="select"
        size="sm"
        :options="[
          { label: __('Open'), value: 'open' },
          { label: __('Resolved'), value: 'resolved' },
          { label: __('Ignored'), value: 'ignored' },
          { label: __('All'), value: 'all' },
        ]"
        @update:modelValue="refresh"
      />
      <div class="ml-auto text-sm text-ink-gray-6">
        {{ __('Total: {0}', [String(conflicts.data?.length || 0)]) }}
      </div>
    </div>

    <!-- List -->
    <div class="flex-1 overflow-auto">
      <div v-if="conflicts.loading" class="p-8 text-center text-ink-gray-6">
        {{ __('Loading conflicts...') }}
      </div>
      <div
        v-else-if="(conflicts.data?.length || 0) === 0"
        class="p-8 text-center text-ink-gray-6"
      >
        {{ __('No conflicts in this view.') }}
      </div>
      <table v-else class="w-full text-sm">
        <thead
          class="sticky top-0 border-b bg-surface-white text-left text-xs uppercase text-ink-gray-6"
        >
          <tr>
            <th class="px-5 py-3">{{ __('Conflict') }}</th>
            <th class="px-5 py-3">{{ __('Email') }}</th>
            <th class="px-5 py-3">{{ __('Status') }}</th>
            <th class="px-5 py-3">{{ __('Detected') }}</th>
            <th class="px-5 py-3">{{ __('Source') }}</th>
            <th class="px-5 py-3">{{ __('Leads') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in conflicts.data || []"
            :key="row.name"
            class="cursor-pointer border-b hover:bg-surface-gray-2"
            @click="openConflict(row.name)"
          >
            <td class="px-5 py-3 font-medium text-ink-gray-9">
              {{ row.name }}
            </td>
            <td class="px-5 py-3 text-ink-gray-8">
              <code class="text-xs">{{ row.email }}</code>
            </td>
            <td class="px-5 py-3">
              <Badge
                :label="row.status"
                :theme="statusTheme(row.status)"
                variant="subtle"
              />
            </td>
            <td class="px-5 py-3 text-ink-gray-7">
              {{ formatDate(row.detected_at) }}
            </td>
            <td class="px-5 py-3 text-ink-gray-7">
              <code class="text-xs">{{ row.detected_by || '' }}</code>
            </td>
            <td class="px-5 py-3 text-ink-gray-7">
              {{ row.lead_count }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import LayoutHeader from '@/components/LayoutHeader.vue'
import { Breadcrumbs, Button, Badge, FormControl, createResource } from 'frappe-ui'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()

const breadcrumbs = [
  { label: 'Lead Email Conflicts' },
]

// Admin gate — checked server-side because `isManager()` from the
// existing users store doesn't include the "Autoklose Admin" role
// our backend treats as admin-bypass. Server is authoritative.
const isAdmin = ref(false)
const adminCheck = createResource({
  url: 'firmadapt_crm.lead_conflicts.is_conflict_admin',
  auto: true,
  onSuccess(value) {
    isAdmin.value = !!value
    if (!value) {
      // Soft redirect — non-admin users see the message above briefly,
      // then we route them back. Hard redirect skipped so deep-links
      // are debuggable.
    }
  },
})

const statusFilter = ref('open')

// Single backend call returns conflicts + lead_count via one SQL join.
// Replaces an earlier N+1 frappe.client.get_count loop that mutated
// row objects post-render — which Vue couldn't track, so the count
// column stayed blank in the rendered DOM.
const conflicts = createResource({
  url: 'firmadapt_crm.lead_conflicts.list_conflicts',
  makeParams: () => ({
    status: statusFilter.value === 'all' ? '' : statusFilter.value,
  }),
})

onMounted(() => {
  conflicts.fetch()
})

function refresh() {
  conflicts.fetch()
}

function openConflict(name) {
  router.push({ name: 'LeadConflict', params: { name } })
}

function statusTheme(status) {
  if (status === 'open') return 'orange'
  if (status === 'resolved') return 'green'
  if (status === 'ignored') return 'gray'
  return 'gray'
}

function formatDate(value) {
  if (!value) return ''
  try {
    const d = new Date(value)
    return d.toLocaleString()
  } catch {
    return value
  }
}
</script>
