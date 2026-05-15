<template>
  <!--
    FirmAdapt Module BetterEnrich — per-Lead enrichment dropdown.

    BetterEnrich is a costly third-party enrichment service with strict
    admin-controlled per-user / per-hour / per-day quotas. Unlike Vayne
    (one shape — LinkedIn profile), BetterEnrich exposes multiple
    independent calls (find work email, find personal email, find
    mobile, find LinkedIn by email, verify email) — each with its own
    cost class (email / phone / other / verify).

    UX surface: a single Dropdown button on the Lead header. Each
    dropdown entry shows the action's remaining quota inline so the
    user can decide whether to spend a credit, e.g.:

        Find work email (3/10 hr, 12/50 today)

    Visibility:
      - Hidden entirely unless the user has the `Autoklose User` role
        (re-uses the existing role — no new perm).
      - Hidden if `get_my_quota()` fails / errors at construction
        (treated as "BetterEnrich not configured / disabled").

    Disabled states (per action):
      - Lead missing prerequisite field (e.g. no company website for
        work-email) → "Set X first" tooltip.
      - Quota exhausted → "Hourly quota reached — resets within the
        hour" — suffix rendered in red text.
      - User disabled by admin (`scope: 'user_disabled'`) → "BetterEnrich
        access is disabled. Contact an admin."

    Each successful action refreshes the quota so the suffix on every
    other action stays accurate (the call may consume credits that
    affect e.g. the daily-limit row).
  -->
  <Dropdown
    v-if="autokloseUserFlag && betterEnrichEnabled"
    :options="actions"
    placement="right"
  >
    <Button
      :label="__('BetterEnrich')"
      icon-left="search"
      variant="subtle"
      theme="blue"
      :loading="busy"
    />
  </Dropdown>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Button, Dropdown, createResource, call, toast } from 'frappe-ui'

const props = defineProps({
  // Whole leadDoc — we read prerequisites (email, company website) off
  // it. Passing the doc keeps prerequisite gates reactive without
  // extra round-trips.
  leadDoc: { type: Object, required: true },
})

const emit = defineEmits(['enriched'])

const busy = ref(false)

// ─── Role + integration gate ─────────────────────────────────────────
// Same pattern as EnrichButton: cheap createResource at mount, hides
// the button cleanly for users without the Autoklose role. The
// integration-enabled flag is derived from whether `get_my_quota()`
// resolves — if BetterEnrich isn't configured on the site, the call
// errors and we hide the surface.

const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

const betterEnrichEnabled = ref(false)
const quota = ref(null) // {email, phone, other, verify}

const quotaResource = createResource({
  url: 'firmadapt_crm.integrations.betterenrich.api.get_my_quota',
  auto: true,
  onSuccess: (data) => {
    quota.value = data || null
    betterEnrichEnabled.value = !!data
  },
  onError: () => {
    quota.value = null
    betterEnrichEnabled.value = false
  },
})

function refreshQuota() {
  // After a successful action the quota counts move; re-fetch so the
  // dropdown suffixes stay accurate for the next click.
  quotaResource.reload?.()
}

// ─── Quota label helpers ─────────────────────────────────────────────
//
// Three shapes we need to handle:
//   1. Normal:        {user_hourly_used, user_hourly_limit,
//                      user_daily_used, user_daily_limit}
//   2. User disabled: {scope: 'user_disabled', remaining: 0}
//   3. Missing key:   undefined  → render no suffix (treat as unknown).

function quotaState(key) {
  // Returns one of:
  //   { kind: 'unknown' }
  //   { kind: 'disabled' }
  //   { kind: 'ok', hourlyUsed, hourlyLimit, dailyUsed, dailyLimit,
  //     exhausted }
  const q = quota.value?.[key]
  if (!q) return { kind: 'unknown' }
  if (q.scope === 'user_disabled') return { kind: 'disabled' }
  const hUsed = Number(q.user_hourly_used ?? 0)
  const hLim = Number(q.user_hourly_limit ?? 0)
  const dUsed = Number(q.user_daily_used ?? 0)
  const dLim = Number(q.user_daily_limit ?? 0)
  const hourlyExhausted = hLim > 0 && hUsed >= hLim
  const dailyExhausted = dLim > 0 && dUsed >= dLim
  return {
    kind: 'ok',
    hourlyUsed: hUsed,
    hourlyLimit: hLim,
    dailyUsed: dUsed,
    dailyLimit: dLim,
    hourlyExhausted,
    dailyExhausted,
    exhausted: hourlyExhausted || dailyExhausted,
  }
}

function quotaSuffix(key) {
  const s = quotaState(key)
  if (s.kind !== 'ok') return ''
  return ` (${s.hourlyUsed}/${s.hourlyLimit} hr, ${s.dailyUsed}/${s.dailyLimit} today)`
}

// ─── Action definitions ──────────────────────────────────────────────
//
// Each action declares its endpoint, cost class (which quota row to
// read), human-readable label, and a `prerequisite()` that returns
// either null (ok) or a string explaining what's missing.
//
// The label is `${base}${suffix}` — the dropdown surface is plain
// text, so we don't get rich styling for the "in red" requirement on
// exhausted quotas; we keep the suffix and just disable the entry. A
// rendered-red variant would require a custom component option, which
// is more complexity than warranted for v1.

const ACTION_DEFS = [
  {
    key: 'work_email',
    quotaKey: 'email',
    method: 'firmadapt_crm.integrations.betterenrich.api.find_work_email',
    label: 'Find work email',
    successField: 'work email',
    prerequisite: (doc) => {
      // The backend already enforces prerequisites; the client-side
      // check is purely a UX hint so we don't burn a round-trip when
      // we already know it'll 412. Work-email lookup needs first +
      // last + company website (or similar). We surface the most
      // common missing field — company website — when no email is
      // present yet (otherwise the user could be running it just to
      // re-find).
      if (!doc?.first_name && !doc?.last_name) {
        return __('Set Lead first/last name first.')
      }
      const company =
        doc?.website || doc?.organization || doc?.no_of_employees
      if (!doc?.website && !doc?.organization) {
        return __('Set Lead company website or organization first.')
      }
      return null
    },
  },
  {
    key: 'personal_email',
    quotaKey: 'email',
    method: 'firmadapt_crm.integrations.betterenrich.api.find_personal_email',
    label: 'Find personal email',
    successField: 'personal email',
    prerequisite: (doc) => {
      if (!doc?.first_name && !doc?.last_name) {
        return __('Set Lead first/last name first.')
      }
      return null
    },
  },
  {
    key: 'mobile_phone',
    quotaKey: 'phone',
    method: 'firmadapt_crm.integrations.betterenrich.api.find_mobile_phone',
    // Phone credits are the most expensive cost class — flag it in
    // the label so the user knows clicking is a deliberate spend.
    label: 'Find mobile phone (costly)',
    successField: 'mobile phone',
    prerequisite: (doc) => {
      if (!doc?.first_name && !doc?.last_name) {
        return __('Set Lead first/last name first.')
      }
      return null
    },
  },
  {
    key: 'linkedin_by_email',
    quotaKey: 'other',
    method:
      'firmadapt_crm.integrations.betterenrich.api.find_linkedin_by_email',
    label: 'Find LinkedIn by email',
    successField: 'LinkedIn URL',
    prerequisite: (doc) => {
      if (!doc?.email) {
        return __('Set Lead email first.')
      }
      return null
    },
  },
  {
    key: 'verify_email',
    quotaKey: 'verify',
    method: 'firmadapt_crm.integrations.betterenrich.api.verify_email',
    label: 'Verify current email',
    successField: 'email verification',
    prerequisite: (doc) => {
      if (!doc?.email) {
        return __('Set Lead email first.')
      }
      return null
    },
  },
]

const actions = computed(() =>
  ACTION_DEFS.map((def) => {
    const s = quotaState(def.quotaKey)
    const preReq = def.prerequisite ? def.prerequisite(props.leadDoc) : null
    const suffix = quotaSuffix(def.quotaKey)
    const label = __(def.label) + suffix

    let disabled = false
    let disabledReason = ''
    if (s.kind === 'disabled') {
      disabled = true
      disabledReason = __(
        'BetterEnrich access is disabled. Contact an admin.',
      )
    } else if (s.kind === 'ok' && s.exhausted) {
      disabled = true
      disabledReason = s.hourlyExhausted
        ? __('Hourly quota reached — resets within the hour.')
        : __('Daily quota reached — resets at midnight.')
    } else if (preReq) {
      disabled = true
      disabledReason = preReq
    }

    return {
      label,
      // frappe-ui Dropdown options accept `disabled` + `tooltip`
      // alongside the standard `onClick`. When disabled the click is
      // a no-op anyway, but we keep the handler safe.
      disabled,
      tooltip: disabledReason || undefined,
      onClick: () => {
        if (disabled) return
        runAction(def)
      },
    }
  }),
)

// ─── Click handler ───────────────────────────────────────────────────
//
// All five per-Lead actions share the same request/response shape:
//   { ok, usage_log_name, quota: {…} }
// and raise frappe.ValidationError on rate-limit / permission errors.
// We funnel them through one helper to keep the toast / refresh /
// emit flow identical.

async function runAction(def) {
  if (!props.leadDoc?.name || busy.value) return
  busy.value = true
  try {
    const resp = await call(def.method, { lead_name: props.leadDoc.name })
    // Some BetterEnrich endpoints find nothing without erroring — the
    // backend still returns ok:true with the usage row recorded. Make
    // the toast informative either way.
    if (resp?.ok === false) {
      toast.create({
        message: __('BetterEnrich: no {0} found for this Lead.', [
          __(def.successField),
        ]),
        type: 'warning',
      })
    } else {
      toast.create({
        message: __('BetterEnrich: {0} lookup complete.', [
          __(def.successField),
        ]),
        type: 'success',
      })
    }
    // If the server piggy-backed a fresh quota snapshot in the
    // response, take it directly (saves a round-trip). Otherwise re-
    // fetch.
    if (resp?.quota) {
      quota.value = resp.quota
    } else {
      refreshQuota()
    }
    emit('enriched', resp)
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('BetterEnrich call failed.'),
      type: 'error',
    })
    // Rate-limit errors don't update quota counts on the client; pull
    // a fresh snapshot just in case.
    refreshQuota()
  } finally {
    busy.value = false
  }
}

// Exposed for tests — lets a Vitest spec drive quotaState() /
// action label generation without mounting the full Dropdown tree.
defineExpose({
  actions,
  quotaState,
  quotaSuffix,
})
</script>
