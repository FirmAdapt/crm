<template>
  <div
    v-if="visible"
    class="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-5 py-3 text-amber-900"
  >
    <FeatherIcon name="alert-triangle" class="mt-0.5 h-5 w-5 shrink-0" />
    <div class="flex-1 text-sm">
      <div class="font-medium">
        {{ __('Lead frozen — Lead Email Conflict pending resolution') }}
      </div>
      <div class="mt-0.5 text-amber-800">
        {{
          __(
            'Another user owns a Lead with the same email address. Outbound emails and Autoklose pushes are blocked on this Lead until an admin resolves the conflict.',
          )
        }}
      </div>
    </div>
    <Button
      v-if="conflictName"
      :label="__('View conflict')"
      variant="outline"
      size="sm"
      @click="openConflict"
    />
  </div>
</template>

<script setup>
import { Button, FeatherIcon, createResource } from 'frappe-ui'
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  // The CRM Lead's `custom_lead_email_conflict_frozen` value (Check field;
  // 0/1 from the doc). When falsy, the banner stays hidden — no fetch.
  frozen: { type: [Number, Boolean], default: 0 },
  // The Lead's `name` so we can deep-link to its open conflict.
  leadName: { type: String, default: '' },
})

const router = useRouter()

const conflictForLead = createResource({
  url: 'firmadapt_crm.lead_conflicts.get_open_conflict_for_lead',
  makeParams: () => ({ lead_name: props.leadName }),
})

const visible = computed(() => !!props.frozen)
const conflictName = computed(() => conflictForLead.data || '')

// Only fetch when actually frozen — no extra round-trip otherwise.
watch(
  () => [props.frozen, props.leadName],
  ([f, n]) => {
    if (f && n) {
      conflictForLead.fetch()
    }
  },
  { immediate: true },
)

function openConflict() {
  if (!conflictName.value) return
  router.push({
    name: 'LeadConflict',
    params: { name: conflictName.value },
  })
}
</script>
