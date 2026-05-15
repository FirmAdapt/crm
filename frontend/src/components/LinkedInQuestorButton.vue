<template>
  <!--
    FirmAdapt Module LinkedIn Questor — per-Lead enrichment button.

    Replaces the previous Vayne enrichment surface. LinkedIn Questor is
    a RapidAPI-backed enrichment service: it fetches a LinkedIn profile
    (skills, certifications, recent activity, open-to-work / open-
    profile flags) plus the linked company record and writes the result
    back to the Lead with existing-wins mapping (rep edits are never
    overwritten).

    UX surface — single primary action with a Dropdown chevron for
    advanced overrides:
      - Primary "Enrich from LinkedIn" button calls
        `enrich_lead(lead_name)` with no flags — server uses the
        Settings defaults for include_skills / include_certifications /
        include_signals / include_company.
      - Dropdown chevron exposes three toggles (Include signals /
        Include certifications / Include company data). Toggling them
        sends explicit booleans for those three flags on the next call,
        overriding the Settings default for that one invocation.
      - include_skills is left at Settings default (cheap, near-always
        on) to keep the dropdown short.

    Visibility:
      - Hidden entirely unless the user has the `Autoklose User` role
        (re-uses the existing role — no new perm).
      - Hidden if `get_my_credits()` fails / errors at construction
        (treated as "LinkedIn Questor not configured / disabled").

    Disabled state:
      - Lead missing custom_linkedin_url → tooltip "Set a LinkedIn URL
        on this lead first." We wrap the disabled Button in a Tooltip
        because a native disabled <button> swallows pointer events and
        the Button's own :tooltip prop never fires.

    On success: green toast with fields_updated / fields_skipped /
    credits_remaining. Emits @enriched so the parent Lead.vue reloads
    the doc and renders the new field values in the side panel.
  -->
  <template v-if="autokloseUserFlag && questorEnabled">
    <Tooltip
      v-if="!linkedinUrl"
      :text="__('Set a LinkedIn URL on this lead first.')"
    >
      <Button
        :label="__('Enrich from LinkedIn')"
        icon-left="linkedin"
        variant="subtle"
        theme="gray"
        :disabled="true"
      />
    </Tooltip>
    <div v-else class="flex items-center gap-1">
      <Button
        :label="__('Enrich from LinkedIn')"
        icon-left="linkedin"
        variant="subtle"
        theme="blue"
        :loading="enriching"
        @click="onEnrich"
      />
      <!-- Chevron sits flush with the main button to read as one
           split-button surface even though frappe-ui has no ButtonGroup
           primitive. The Dropdown's slot is what gets clicked; the
           options array is the override toggles. -->
      <Dropdown :options="advancedOptions" placement="right">
        <Button
          icon="chevron-down"
          variant="subtle"
          theme="blue"
          :disabled="enriching"
        />
      </Dropdown>
    </div>
  </template>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Button,
  Dropdown,
  Tooltip,
  createResource,
  call,
  toast,
} from 'frappe-ui'

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

// ─── Role + integration gate ─────────────────────────────────────────
// Same pattern as EnrichButton / BetterEnrichButton: cheap createResource
// at mount, hides the button cleanly for users without the Autoklose
// role. The integration-enabled flag is derived from whether
// `get_my_credits()` resolves — if LinkedIn Questor isn't configured
// on the site (or admin has flipped enabled=0), the call errors and we
// hide the surface.

const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

const questorEnabled = ref(false)
const creditsRemaining = ref(null)

createResource({
  url: 'firmadapt_crm.integrations.linkedin_questor.api.get_my_credits',
  auto: true,
  onSuccess: (v) => {
    // Backend returns an int credit count from the cached Settings
    // field. Any successful resolution means the integration is
    // configured AND enabled — that's the bar for showing the button.
    creditsRemaining.value = typeof v === 'number' ? v : Number(v) || 0
    questorEnabled.value = true
  },
  onError: () => {
    creditsRemaining.value = null
    questorEnabled.value = false
  },
})

// ─── Advanced-option overrides ───────────────────────────────────────
//
// Each toggle starts at `null` ("use Settings default"). Clicking the
// dropdown entry flips it through three states:
//   null  → true    ("force on")
//   true  → false   ("force off")
//   false → null    ("default")
//
// The send-time payload omits the key when null, so the backend sees
// "no override" and falls back to LinkedIn Questor Settings.

const overrides = ref({
  include_signals: null,
  include_certifications: null,
  include_company: null,
})

function cycle(key) {
  const cur = overrides.value[key]
  if (cur === null) overrides.value[key] = true
  else if (cur === true) overrides.value[key] = false
  else overrides.value[key] = null
}

function badge(key) {
  const v = overrides.value[key]
  if (v === true) return ' (on)'
  if (v === false) return ' (off)'
  return ''
}

const advancedOptions = computed(() => [
  {
    label: __('Include signals') + badge('include_signals'),
    onClick: () => cycle('include_signals'),
  },
  {
    label: __('Include certifications') + badge('include_certifications'),
    onClick: () => cycle('include_certifications'),
  },
  {
    label: __('Include company data') + badge('include_company'),
    onClick: () => cycle('include_company'),
  },
])

// ─── Action ──────────────────────────────────────────────────────────
async function onEnrich() {
  if (!props.leadDoc?.name || enriching.value) return
  enriching.value = true
  try {
    // Build payload — drop null entries so the backend uses the
    // Settings default for un-overridden flags.
    const args = { lead_name: props.leadDoc.name }
    for (const k of Object.keys(overrides.value)) {
      if (overrides.value[k] !== null) args[k] = overrides.value[k]
    }
    const resp = await call(
      'firmadapt_crm.integrations.linkedin_questor.api.enrich_lead',
      args,
    )
    const updated = resp?.fields_updated || []
    const skipped = resp?.fields_skipped || []
    const credits = resp?.credits_remaining
    creditsRemaining.value = typeof credits === 'number' ? credits : creditsRemaining.value
    toast.create({
      message: __(
        'Enriched: {0} field(s) updated, {1} skipped. {2} credits left.',
        [updated.length, skipped.length, credits ?? '?'],
      ),
      type: updated.length > 0 ? 'success' : 'warning',
    })
    // Tell the parent to reload — new field values won't render in
    // the side panel otherwise (frappe-ui caches doc data per name).
    emit('enriched', resp)
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('LinkedIn Questor failed.'),
      type: 'error',
    })
  } finally {
    enriching.value = false
  }
}

// Exposed for tests — lets a Vitest spec drive the override cycling +
// payload-building without mounting the full Dropdown tree.
defineExpose({
  overrides,
  advancedOptions,
  cycle,
  badge,
  creditsRemaining,
})
</script>
