<template>
  <!-- Hidden entirely when:
       - the user has no Autoklose role (no point fetching campaigns
         they couldn't open anyway)
       - the fetch returned no rows for this lead (avoids an empty
         section taking up vertical space in the side panel) -->
  <div
    v-if="autokloseUserFlag && campaigns.data?.length"
    class="border-b px-5 py-3"
  >
    <div class="mb-2 flex items-center justify-between">
      <span class="text-sm font-medium text-ink-gray-9">
        {{ __('Autoklose Campaigns') }}
      </span>
      <span class="text-xs text-ink-gray-5">
        {{ campaigns.data.length }}
      </span>
    </div>
    <div class="flex flex-col gap-2">
      <router-link
        v-for="c in campaigns.data"
        :key="c.name"
        :to="{ name: 'Campaign', params: { campaignId: c.name } }"
        class="flex items-center gap-2 rounded px-2 py-1.5 -mx-2 hover:bg-surface-menu-bar"
      >
        <IndicatorIcon :class="parseColor(STATUS_COLOR[c.status] || 'gray')" />
        <div class="flex-1 truncate text-sm text-ink-gray-9">
          {{ c.campaign_name || c.name }}
        </div>
        <Tooltip
          v-if="c.last_contacted_at"
          :text="formatDate(c.last_contacted_at)"
        >
          <span class="text-xs text-ink-gray-5 shrink-0">
            {{ timeAgo(c.last_contacted_at) }}
          </span>
        </Tooltip>
      </router-link>
    </div>
  </div>
</template>

<script setup>
import IndicatorIcon from '@/components/Icons/IndicatorIcon.vue'
import { Tooltip, createResource } from 'frappe-ui'
import { parseColor, formatDate, timeAgo } from '@/utils'
import { ref, watch } from 'vue'

const props = defineProps({
  leadId: { type: String, required: true },
})

// Same map used by Campaigns.vue / CampaignsListView.vue / Campaign.vue.
// Kept locally rather than imported because it's tiny and the SPA hasn't
// converged on a shared status-color module yet (good follow-up if the
// number of Autoklose-touching components grows).
const STATUS_COLOR = {
  active: 'green',
  paused: 'orange',
  draft: 'gray',
  finished: 'blue',
  archived: 'gray',
}

// Hide the panel entirely for users without an Autoklose role. Same
// gate the sidebar uses; cheap call, fired once per Lead-page mount.
const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

// One fetch per leadId. The server method enforces read-permission on
// the Lead, so non-owners get [] (and the v-if hides the panel).
const campaigns = createResource({
  url: 'firmadapt_crm.integrations.autoklose.api.get_campaigns_for_lead',
  params: { lead: props.leadId },
  auto: true,
})
watch(
  () => props.leadId,
  (id) => {
    campaigns.update({ params: { lead: id } })
    campaigns.fetch()
  },
)
</script>
