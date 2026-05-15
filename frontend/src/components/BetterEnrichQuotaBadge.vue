<template>
  <!--
    FirmAdapt Module BetterEnrich — at-a-glance quota badge.

    Small inline pill that surfaces the most-relevant BetterEnrich
    quota row (email — the cost class most commonly used in daily
    work). Mounts next to the BetterEnrichButton in the Lead header so
    users can see "BetterEnrich: 12/50 today" without opening the
    dropdown.

    Color rules (mirrors quota state in BetterEnrichButton):
      - >25% remaining → green
      - 1–25% remaining → orange
      - 0 (exhausted)  → red
      - user_disabled  → gray, label "disabled"

    Hidden entirely when the user lacks the Autoklose role or
    BetterEnrich is not configured (get_my_quota fails).
  -->
  <Tooltip v-if="show" :text="tooltipText">
    <span
      class="inline-flex items-center rounded px-2 py-1 text-xs font-medium"
      :class="badgeClass"
      data-test="be-quota-badge"
    >
      {{ badgeText }}
    </span>
  </Tooltip>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Tooltip, createResource } from 'frappe-ui'

const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

const quota = ref(null)
const quotaLoaded = ref(false)
createResource({
  url: 'firmadapt_crm.integrations.betterenrich.api.get_my_quota',
  auto: true,
  onSuccess: (data) => {
    quota.value = data || null
    quotaLoaded.value = true
  },
  onError: () => {
    quota.value = null
    quotaLoaded.value = false
  },
})

const show = computed(
  () => autokloseUserFlag.value && quotaLoaded.value && !!quota.value,
)

const emailRow = computed(() => quota.value?.email || null)

const disabled = computed(() => emailRow.value?.scope === 'user_disabled')

const dailyUsed = computed(() => Number(emailRow.value?.user_daily_used ?? 0))
const dailyLimit = computed(
  () => Number(emailRow.value?.user_daily_limit ?? 0),
)

const remainingPct = computed(() => {
  if (disabled.value || dailyLimit.value <= 0) return 0
  const remaining = Math.max(0, dailyLimit.value - dailyUsed.value)
  return (remaining / dailyLimit.value) * 100
})

const badgeText = computed(() => {
  if (!emailRow.value) return ''
  if (disabled.value) return __('BetterEnrich: disabled')
  return __('BetterEnrich: {0}/{1} today', [
    dailyUsed.value,
    dailyLimit.value,
  ])
})

const badgeClass = computed(() => {
  if (disabled.value) return 'bg-surface-gray-2 text-ink-gray-6'
  if (remainingPct.value === 0) return 'bg-surface-red-2 text-ink-red-6'
  if (remainingPct.value < 25)
    return 'bg-surface-amber-2 text-ink-amber-6'
  return 'bg-surface-green-2 text-ink-green-6'
})

const tooltipText = computed(() => {
  if (!emailRow.value) return ''
  if (disabled.value) {
    return __('BetterEnrich access is disabled. Contact an admin.')
  }
  const hUsed = Number(emailRow.value.user_hourly_used ?? 0)
  const hLim = Number(emailRow.value.user_hourly_limit ?? 0)
  return __(
    'BetterEnrich email quota — {0}/{1} this hour, {2}/{3} today.',
    [hUsed, hLim, dailyUsed.value, dailyLimit.value],
  )
})
</script>
