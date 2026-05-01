<template>
  <LayoutHeader>
    <template #left-header>
      <Breadcrumbs :items="breadcrumbs" />
    </template>
    <template #right-header>
      <Button
        v-if="conflict.data && conflict.data.status === 'open'"
        :label="__('Ignore conflict')"
        variant="subtle"
        @click="onIgnore"
      />
      <Button
        v-if="conflict.data && conflict.data.status === 'open'"
        :label="__('Resolve')"
        variant="solid"
        :disabled="!canonicalLead"
        @click="onResolve"
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

  <div v-else-if="conflict.loading" class="p-8 text-center text-ink-gray-6">
    {{ __('Loading conflict...') }}
  </div>

  <div
    v-else-if="conflict.error"
    class="p-8 text-center text-ink-red-7"
  >
    {{ __('Could not load conflict.') }}
    <pre class="text-xs">{{ conflict.error?.messages?.join('\n') }}</pre>
  </div>

  <div
    v-else-if="conflict.data"
    class="flex h-full flex-col overflow-auto"
  >
    <!-- Status header -->
    <div
      class="flex items-center gap-3 border-b px-5 py-3"
      :class="{
        'bg-surface-amber-2': conflict.data.status === 'open',
        'bg-surface-green-2': conflict.data.status === 'resolved',
        'bg-surface-gray-2': conflict.data.status === 'ignored',
      }"
    >
      <Badge
        :label="conflict.data.status"
        :theme="statusTheme(conflict.data.status)"
        variant="solid"
      />
      <div class="flex flex-col gap-0.5">
        <div class="text-sm font-medium text-ink-gray-9">
          {{ __('Email:') }}
          <code class="ml-1">{{ conflict.data.email }}</code>
        </div>
        <div class="text-xs text-ink-gray-6">
          {{ __('Detected by') }}
          <code>{{ conflict.data.detected_by }}</code>
          {{ __('at') }}
          {{ formatDate(conflict.data.detected_at) }}
        </div>
      </div>
    </div>

    <!-- Resolved/ignored summary -->
    <div
      v-if="conflict.data.status !== 'open'"
      class="border-b px-5 py-3 text-sm text-ink-gray-7"
    >
      <div>
        <strong>{{ __('Resolved at:') }}</strong>
        {{ formatDate(conflict.data.resolved_at) }}
      </div>
      <div v-if="conflict.data.resolved_by">
        <strong>{{ __('Resolved by:') }}</strong>
        {{ conflict.data.resolved_by }}
      </div>
      <div v-if="conflict.data.canonical_lead">
        <strong>{{ __('Canonical lead:') }}</strong>
        <router-link
          :to="{
            name: 'Lead',
            params: { leadId: conflict.data.canonical_lead },
          }"
          class="ml-1 text-ink-blue-6 hover:underline"
          >{{ conflict.data.canonical_lead }}</router-link
        >
      </div>
      <div v-if="conflict.data.resolution_note" class="mt-2">
        <strong>{{ __('Note:') }}</strong>
        <div class="whitespace-pre-wrap">
          {{ conflict.data.resolution_note }}
        </div>
      </div>
    </div>

    <!-- Lead table -->
    <div class="px-5 py-4">
      <div class="mb-2 text-sm font-medium text-ink-gray-9">
        {{ __('Conflicting Leads') }}
      </div>
      <div class="rounded border border-outline-gray-2">
        <table class="w-full text-sm">
          <thead class="bg-surface-gray-2 text-xs uppercase text-ink-gray-6">
            <tr>
              <th class="px-3 py-2 text-left">{{ __('Lead') }}</th>
              <th class="px-3 py-2 text-left">{{ __('Owner') }}</th>
              <th class="px-3 py-2 text-left">{{ __('Email') }}</th>
              <th class="px-3 py-2 text-center">{{ __('Keep') }}</th>
              <th class="px-3 py-2 text-left">{{ __('Action') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in conflict.data.leads"
              :key="row.lead"
              class="border-t"
            >
              <td class="px-3 py-2">
                <router-link
                  v-if="row.exists"
                  :to="{
                    name: 'Lead',
                    params: { leadId: row.lead },
                  }"
                  class="text-ink-blue-6 hover:underline"
                  >{{ row.lead }}</router-link
                >
                <span v-else class="text-ink-gray-5 line-through">{{
                  row.lead
                }}</span>
                <div v-if="row.first_name" class="text-xs text-ink-gray-6">
                  {{ row.first_name }}
                </div>
              </td>
              <td class="px-3 py-2 text-ink-gray-8">
                {{ row.current_lead_owner || row.lead_owner_at_detection || '—' }}
                <div
                  v-if="
                    row.current_lead_owner &&
                    row.lead_owner_at_detection &&
                    row.current_lead_owner !== row.lead_owner_at_detection
                  "
                  class="text-xs text-ink-amber-7"
                >
                  ({{ __('was') }} {{ row.lead_owner_at_detection }})
                </div>
              </td>
              <td class="px-3 py-2 text-ink-gray-8">
                <code class="text-xs">{{ row.current_email || '—' }}</code>
              </td>
              <td class="px-3 py-2 text-center">
                <input
                  type="radio"
                  :name="'canonical'"
                  :value="row.lead"
                  v-model="canonicalLead"
                  :disabled="
                    conflict.data.status !== 'open' || !row.exists
                  "
                />
              </td>
              <td class="px-3 py-2">
                <div
                  v-if="canonicalLead === row.lead"
                  class="text-xs text-ink-green-7"
                >
                  {{ __('keep') }}
                </div>
                <div v-else-if="!row.exists" class="text-xs text-ink-gray-5">
                  {{ __('already deleted') }}
                </div>
                <div v-else-if="conflict.data.status !== 'open'" class="text-xs">
                  <code>{{ row.resolution_action || '—' }}</code>
                </div>
                <div v-else class="flex items-center gap-2">
                  <FormControl
                    v-model="actionsByLead[row.lead]"
                    type="select"
                    size="sm"
                    :options="[
                      { label: __('Delete'), value: 'delete' },
                      { label: __('Reassign'), value: 'reassign' },
                      { label: __('Mark DNE'), value: 'mark_dne' },
                    ]"
                  />
                  <FormControl
                    v-if="actionsByLead[row.lead] === 'reassign'"
                    v-model="reassignByLead[row.lead]"
                    type="text"
                    size="sm"
                    :placeholder="__('user@email.com')"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        v-if="conflict.data.status === 'open'"
        class="mt-2 text-xs text-ink-gray-6"
      >
        {{
          __(
            'Pick exactly one Lead to keep, then choose what happens to the others. Default for non-canonical Leads is delete.',
          )
        }}
      </div>
    </div>

    <!-- Resolution note -->
    <div v-if="conflict.data.status === 'open'" class="px-5 pb-5">
      <div class="mb-2 text-sm font-medium text-ink-gray-9">
        {{ __('Resolution note (optional)') }}
      </div>
      <FormControl
        v-model="note"
        type="textarea"
        :rows="3"
        :placeholder="__('Why this resolution? Saved on the conflict for audit.')"
      />
    </div>
  </div>
</template>

<script setup>
import LayoutHeader from '@/components/LayoutHeader.vue'
import {
  Breadcrumbs,
  Button,
  Badge,
  FormControl,
  createResource,
  call,
  toast,
} from 'frappe-ui'
import { computed, ref, reactive, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  name: { type: String, required: true },
})

const router = useRouter()

const breadcrumbs = computed(() => [
  { label: 'Lead Email Conflicts', route: { name: 'LeadConflicts' } },
  { label: props.name || '' },
])

const isAdmin = ref(false)
const adminCheck = createResource({
  url: 'firmadapt_crm.lead_conflicts.is_conflict_admin',
  auto: true,
  onSuccess(v) {
    isAdmin.value = !!v
  },
})

// Conflict + child rows in one payload (server-side helper).
const conflict = createResource({
  url: 'firmadapt_crm.lead_conflicts.get_conflict_detail',
  makeParams: () => ({ conflict_name: props.name }),
})

const canonicalLead = ref('')
const actionsByLead = reactive({})
const reassignByLead = reactive({})
const note = ref('')

// Initialize action defaults whenever the conflict payload changes.
watch(
  () => conflict.data,
  (data) => {
    if (!data) return
    if (data.canonical_lead) {
      canonicalLead.value = data.canonical_lead
    }
    for (const row of data.leads || []) {
      if (!actionsByLead[row.lead]) {
        actionsByLead[row.lead] = row.resolution_action || 'delete'
      }
      if (!reassignByLead[row.lead]) {
        reassignByLead[row.lead] = row.reassign_to || ''
      }
    }
    note.value = data.resolution_note || ''
  },
  { immediate: true },
)

onMounted(() => {
  conflict.fetch()
})

function statusTheme(status) {
  if (status === 'open') return 'orange'
  if (status === 'resolved') return 'green'
  if (status === 'ignored') return 'gray'
  return 'gray'
}

function formatDate(value) {
  if (!value) return ''
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function buildActionsPayload() {
  // Shape required by firmadapt_crm.lead_conflicts.resolve_conflict:
  //   {<lead_name>: "delete" | "reassign" | "mark_dne",
  //    "<lead_name>__reassign_to": "<user_email>"}
  const out = {}
  for (const row of conflict.data?.leads || []) {
    if (row.lead === canonicalLead.value) continue
    const action = actionsByLead[row.lead] || 'delete'
    out[row.lead] = action
    if (action === 'reassign') {
      const target = (reassignByLead[row.lead] || '').trim()
      if (!target) {
        throw new Error(
          `Reassign chosen for ${row.lead} but no target user provided.`,
        )
      }
      out[`${row.lead}__reassign_to`] = target
    }
  }
  return out
}

async function onResolve() {
  if (!canonicalLead.value) {
    toast.warning(__('Pick one Lead to keep before resolving.'))
    return
  }
  let actions
  try {
    actions = buildActionsPayload()
  } catch (e) {
    toast.error(e.message)
    return
  }
  try {
    const result = await call(
      'firmadapt_crm.lead_conflicts.resolve_conflict',
      {
        conflict_name: props.name,
        canonical_lead: canonicalLead.value,
        actions: JSON.stringify(actions),
        note: note.value || '',
      },
    )
    toast.success(
      __('Conflict resolved. Canonical lead: {0}', [result.canonical_lead]),
    )
    conflict.fetch()
  } catch (e) {
    const msg =
      e?.messages?.join('\n') ||
      e?.exc_type ||
      e?.message ||
      'Resolution failed.'
    toast.error(msg)
  }
}

async function onIgnore() {
  if (
    !confirm(
      __(
        'Mark this conflict as ignored without picking a canonical Lead? All involved Leads will be unfrozen.',
      ),
    )
  ) {
    return
  }
  try {
    await call('firmadapt_crm.lead_conflicts.ignore_conflict', {
      conflict_name: props.name,
      note: note.value || '',
    })
    toast.success(__('Conflict marked as ignored.'))
    conflict.fetch()
  } catch (e) {
    const msg =
      e?.messages?.join('\n') ||
      e?.exc_type ||
      e?.message ||
      'Ignore failed.'
    toast.error(msg)
  }
}
</script>
