<template>
  <!--
    LinkedIn Questor — per-Lead enrichment button.

    v0.15.0 UX hardening (fixes audit P1 #3, #6):
      - The per-call override panel now shows EACH option's resolved state
        as a right-aligned chip: "default: on" (gray) when the user hasn't
        overridden, "OVERRIDE: on" (blue) / "OVERRIDE: off" (red) when
        they have. Before this release, the user had no way to know what
        the Settings default was, or whether their click toggled the
        default away.
      - The override panel now stays open on item click (Popover instead
        of Dropdown). Setting two flags used to require opening the menu
        twice.

    Other invariants (unchanged):
      - Hidden entirely unless caller has the Autoklose User role.
      - Hidden if LinkedIn Questor isn't configured / enabled (we read
        `get_integration_status` instead of relying on a credits probe).
      - Disabled (with tooltip) when the Lead has no LinkedIn URL.
      - "Reset to defaults" footer appears only when ≥1 override is set.

    On success: green toast + emit @enriched so the parent reloads.
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
      <!-- Popover-based "split button" trigger. Using Popover rather than
           the frappe-ui Dropdown's `:options` array because the options
           pattern auto-closes on every item click — and we want admins
           to be able to toggle multiple overrides without re-opening
           the menu. The active-override count shows as a small badge
           on the trigger so the surface signals "you have overrides
           configured" even when the menu is closed. -->
      <Popover transition="default" placement="bottom-end">
        <template #target="{ togglePopover }">
          <Button
            icon="chevron-down"
            variant="subtle"
            theme="blue"
            :disabled="enriching"
            @click.stop="togglePopover"
          >
            <template v-if="overrideCount > 0" #suffix>
              <span
                class="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-blue-2 px-1 text-xs font-medium text-ink-blue-9"
              >
                {{ overrideCount }}
              </span>
            </template>
          </Button>
        </template>
        <template #body>
          <div
            class="mt-1 w-72 rounded-lg bg-surface-modal shadow-2xl ring-1 ring-black ring-opacity-5"
          >
            <div class="px-3 pb-1 pt-3 text-xs text-ink-gray-5">
              {{ __('Override Settings defaults for this call only.') }}
            </div>
            <button
              v-for="opt in advancedOptions"
              :key="opt.key"
              type="button"
              class="flex w-full items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-surface-menu-bar"
              @click.stop="cycle(opt.key)"
            >
              <span class="text-ink-gray-9">{{ opt.label }}</span>
              <span :class="opt.chipClass">
                {{ opt.chipText }}
              </span>
            </button>
            <div
              v-if="overrideCount > 0"
              class="border-t px-3 py-2"
            >
              <button
                type="button"
                class="text-xs text-ink-gray-7 hover:text-ink-gray-9 underline"
                @click.stop="resetOverrides"
              >
                {{ __('Reset to defaults') }}
              </button>
            </div>
          </div>
        </template>
      </Popover>
    </div>
  </template>
</template>

<script setup>
import { ref, computed } from 'vue'
import {
  Button,
  Popover,
  Tooltip,
  createResource,
  call,
  toast,
} from 'frappe-ui'

const props = defineProps({
  leadDoc: { type: Object, required: true },
})
const emit = defineEmits(['enriched'])

const enriching = ref(false)

const linkedinUrl = computed(
  () => (props.leadDoc?.custom_linkedin_url || '').trim(),
)

// ─── Role + integration gate ─────────────────────────────────────────
// `get_integration_status` returns enabled/configured/role_ok plus the
// Settings defaults for each include_* flag. One fetch on mount drives
// both the visibility gate AND the override-chip rendering below.
const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

const status = ref({
  enabled: false,
  configured: false,
  role_ok: false,
  credits_remaining: null,
  defaults: {
    include_skills: false,
    include_certifications: false,
    include_signals: false,
    include_company: false,
  },
})
createResource({
  url: 'firmadapt_crm.integrations.linkedin_questor.api.get_integration_status',
  auto: true,
  onSuccess: (v) => {
    status.value = { ...status.value, ...v }
  },
  onError: () => {
    status.value.enabled = false
    status.value.configured = false
  },
})

// Surface the button only when the integration is BOTH enabled AND
// configured (api_key set). A partial state is the admin's problem,
// not the rep's — hide the button until they sort it.
const questorEnabled = computed(
  () => status.value.enabled && status.value.configured,
)

// ─── Per-call overrides ──────────────────────────────────────────────
//
// Each override starts at `null` ("use Settings default"). Clicking the
// menu item cycles:
//   null  → true    ("force on")
//   true  → false   ("force off")
//   false → null    ("default")
//
// The send-time payload omits keys still at null so the backend falls
// back to LinkedIn Questor Settings.
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

function resetOverrides() {
  overrides.value.include_signals = null
  overrides.value.include_certifications = null
  overrides.value.include_company = null
}

const overrideCount = computed(
  () => Object.values(overrides.value).filter((v) => v !== null).length,
)

// Each option renders its label + a right-aligned chip showing the
// resolved state. Three chip variants:
//   "default: on/off"  (gray)         — no override; what Settings says
//   "OVERRIDE: on"     (blue)         — explicit force-on this call
//   "OVERRIDE: off"    (red)          — explicit force-off this call
//
// This is the P1 #3 fix from the v0.14.0 UX audit. Before, the menu
// items just showed " (on)" / " (off)" suffixes AFTER click — admins
// had no way to know the default state.
const advancedOptions = computed(() => {
  const defaults = status.value.defaults || {}
  return [
    {
      key: 'include_signals',
      label: __('Include signals'),
      ...chipFor(overrides.value.include_signals, defaults.include_signals),
    },
    {
      key: 'include_certifications',
      label: __('Include certifications'),
      ...chipFor(
        overrides.value.include_certifications,
        defaults.include_certifications,
      ),
    },
    {
      key: 'include_company',
      label: __('Include company data'),
      ...chipFor(overrides.value.include_company, defaults.include_company),
    },
  ]
})

function chipFor(override, defaultValue) {
  if (override === null) {
    return {
      chipText: __('default: {0}', [defaultValue ? __('on') : __('off')]),
      chipClass:
        'inline-flex items-center rounded-full bg-surface-gray-2 px-2 py-0.5 text-xs text-ink-gray-7',
    }
  }
  if (override === true) {
    return {
      chipText: __('OVERRIDE: on'),
      chipClass:
        'inline-flex items-center rounded-full bg-surface-blue-2 px-2 py-0.5 text-xs font-medium text-ink-blue-9',
    }
  }
  return {
    chipText: __('OVERRIDE: off'),
    chipClass:
      'inline-flex items-center rounded-full bg-surface-red-2 px-2 py-0.5 text-xs font-medium text-ink-red-9',
  }
}

// ─── Action ──────────────────────────────────────────────────────────
async function onEnrich() {
  if (!props.leadDoc?.name || enriching.value) return
  enriching.value = true
  try {
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
    if (typeof credits === 'number') {
      status.value.credits_remaining = credits
    }
    toast.create({
      message: __(
        'Enriched: {0} field(s) updated, {1} skipped. {2} credits left.',
        [updated.length, skipped.length, credits ?? '?'],
      ),
      type: updated.length > 0 ? 'success' : 'warning',
    })
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

// Exposed for tests.
defineExpose({
  overrides,
  advancedOptions,
  cycle,
  resetOverrides,
  overrideCount,
  status,
})
</script>
