<template>
  <!--
    FirmAdapt Module Vayne — per-Lead LinkedIn enrichment button.

    Renders only for users with the `Autoklose User` role (decision:
    re-use that role rather than spinning up a Vayne-specific one). The
    server `enrich_lead` endpoint enforces the same gate, so this
    component is purely UX hide — non-eligible users see no button.

    Three visual states:
      1. Role-gated: nothing rendered (component returns the empty
         fragment via v-if on the wrapping span).
      2. Has LinkedIn URL: blue subtle button with a zap icon.
      3. No LinkedIn URL: gray disabled button, tooltip explains why.

    On click → POST to `firmadapt_crm.integrations.vayne.api.enrich_lead`.
    Success toast lists fields-updated / fields-skipped / credits-used.
    On success the parent doc is reloaded so the new field values render
    in the side panel.
  -->
  <template v-if="autokloseUserFlag">
    <Tooltip
      v-if="!linkedinUrl"
      :text="__('Lead has no LinkedIn URL — set custom_linkedin_url first.')"
    >
      <Button
        :label="__('Enrich')"
        icon-left="zap"
        variant="subtle"
        theme="gray"
        :disabled="true"
      />
    </Tooltip>
    <Button
      v-else
      :label="__('Enrich')"
      icon-left="zap"
      variant="subtle"
      theme="blue"
      :loading="enriching"
      @click="onEnrich"
    />
  </template>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Button, Tooltip, createResource, call, toast } from 'frappe-ui'

const props = defineProps({
  // The whole leadDoc — we read `name` + `custom_linkedin_url` off it.
  // Passing the doc rather than just the id lets us reactively hide /
  // show based on URL presence without an extra round-trip.
  leadDoc: { type: Object, required: true },
})

const emit = defineEmits(['enriched'])

const enriching = ref(false)

const linkedinUrl = computed(
  () => (props.leadDoc?.custom_linkedin_url || '').trim(),
)

// Gate the whole button on the role. Same pattern as
// LeadAutoklosePanel — cheap, fires once per Lead-page mount, hides
// the button cleanly for users without the Autoklose role.
const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

async function onEnrich() {
  if (!props.leadDoc?.name || enriching.value) return
  enriching.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.vayne.api.enrich_lead',
      { lead_name: props.leadDoc.name },
    )
    const updated = resp?.fields_updated || []
    const skipped = resp?.skipped || []
    const credits = resp?.credits_used ?? 0
    if (updated.length === 0) {
      toast.create({
        message: __(
          'Enriched from LinkedIn — no CRM fields updated (every mapped ' +
            'field already had a value). {0} credit(s) used.',
          [credits],
        ),
        type: 'warning',
      })
    } else {
      toast.create({
        message: __(
          'Enriched from LinkedIn — {0} field(s) updated, {1} skipped ' +
            '(already filled). {2} credit(s) used.',
          [updated.length, skipped.length, credits],
        ),
        type: 'success',
      })
    }
    // Tell the parent to reload — new field values won't render in
    // the side panel otherwise (frappe-ui caches doc data per name).
    emit('enriched', resp)
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Failed to enrich from LinkedIn.'),
      type: 'error',
    })
  } finally {
    enriching.value = false
  }
}
</script>
