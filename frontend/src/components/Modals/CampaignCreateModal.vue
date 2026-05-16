<template>
  <Dialog
    v-model="show"
    :options="{
      title: __('Create Autoklose campaign'),
      size: 'xl',
      actions: [
        {
          label: __('Create campaign'),
          variant: 'solid',
          theme: 'blue',
          loading: creating,
          onClick: runCreate,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <div class="space-y-4">
        <p class="text-sm text-ink-gray-7">
          {{
            __(
              'Creates a new draft campaign on Autoklose and brings it ' +
                'into the CRM cache. Add sequence steps in the Sequence ' +
                'tab afterwards, then click Start to begin sending.',
            )
          }}
        </p>

        <!-- Name + start_date — both required. -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Name') }} *
            </label>
            <FormControl
              v-model="form.name"
              type="text"
              :placeholder="__('Q3 Cold Outreach')"
              :maxlength="200"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Start date') }} *
            </label>
            <FormControl v-model="form.start_date" type="date" />
          </div>
        </div>

        <!-- Schedule row -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Timezone') }}
            </label>
            <FormControl
              v-model="form.timezone"
              type="text"
              :placeholder="__('America/New_York')"
            />
            <p class="mt-1 text-xs text-ink-gray-5">
              {{ __('IANA format (Region/City). Defaults to site TZ.') }}
            </p>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Work hours from') }}
            </label>
            <FormControl v-model="form.work_hours_from" type="time" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Work hours to') }}
            </label>
            <FormControl v-model="form.work_hours_to" type="time" />
          </div>
        </div>

        <!-- Sending days — 7 small checkbox chips inline. -->
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-gray-9">
            {{ __('Sending days') }}
          </label>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="day in DAY_LABELS"
              :key="day.key"
              class="flex items-center gap-1.5 rounded border border-outline-gray-1 px-2 py-1 cursor-pointer hover:bg-surface-menu-bar"
            >
              <input
                v-model="form.sending_days[day.key]"
                type="checkbox"
                class="h-3.5 w-3.5"
              />
              <span class="text-sm text-ink-gray-8">{{ day.label }}</span>
            </label>
          </div>
        </div>

        <!-- Tracking + email account + emails/day -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Email account') }}
            </label>
            <Autocomplete
              v-model="emailAccountOption"
              :options="emailAccountOptions"
              :placeholder="__('(Use Autoklose default)')"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Emails per day') }}
            </label>
            <FormControl
              v-model="form.emails_per_day"
              type="number"
              :placeholder="__('(Unlimited)')"
              min="0"
            />
          </div>
        </div>

        <div>
          <label class="mb-2 block text-sm font-medium text-ink-gray-9">
            {{ __('Tracking') }}
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.track_open" type="checkbox" />
              {{ __('Track opens') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.track_click" type="checkbox" />
              {{ __('Track clicks') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.track_reply" type="checkbox" />
              {{ __('Track replies') }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.track_attachment" type="checkbox" />
              {{ __('Track attachments') }}
            </label>
          </div>
        </div>

        <label class="flex items-center gap-2 text-sm">
          <input v-model="form.is_automated" type="checkbox" />
          {{ __('Automated (start sending automatically after the start date)') }}
        </label>

        <p
          v-if="errorMessage"
          class="rounded border border-outline-red-2 bg-surface-red-1 p-2 text-sm text-ink-red-7"
        >
          {{ errorMessage }}
        </p>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Module 3b — Campaign authoring.
 *
 * Companion to Module 3's StepEditorModal. Where Module 3 lets admins
 * Add/Edit/Delete email steps inside an existing campaign, this modal
 * creates the campaign in the first place. On success the parent
 * navigates the SPA to /crm/campaigns/{new_id} so the admin can
 * immediately add sequence steps and then Start (Module 2).
 *
 * Form contract — `runCreate` POSTs exactly the fields the backend
 * `create_campaign` whitelisted method expects (see
 * firmadapt_crm/integrations/autoklose/campaign_authoring.py). The
 * Autocomplete for email account follows the same v-model-the-full-
 * option pattern as PushToAutokloseModal (the local Autocomplete
 * wrapper only emits @change when bound via `value=""`, not v-model;
 * v-modeling against an option ref + extracting `.value` at POST time
 * is the contract the backend's `_coerce_id` helper expects).
 */
import Autocomplete from '@/components/frappe-ui/Autocomplete.vue'
import { Dialog, FormControl, call, createResource } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

const emit = defineEmits(['created'])
const show = defineModel({ type: Boolean })

// Day labels — kept inline rather than imported so this file stays
// self-contained. Order matches the Autoklose response shape.
const DAY_LABELS = [
  { key: 'Monday', label: 'Mon' },
  { key: 'Tuesday', label: 'Tue' },
  { key: 'Wednesday', label: 'Wed' },
  { key: 'Thursday', label: 'Thu' },
  { key: 'Friday', label: 'Fri' },
  { key: 'Saturday', label: 'Sat' },
  { key: 'Sunday', label: 'Sun' },
]

// Form state. Tracking defaults track the project's existing audit
// posture — opens off (privacy-friendly default), clicks + replies on
// for engagement scoring. Admins can flip any of them in the form.
function makeBlankForm() {
  return {
    name: '',
    start_date: new Date().toISOString().slice(0, 10), // today
    timezone: '',
    work_hours_from: '08:00',
    work_hours_to: '17:00',
    sending_days: {
      Monday: true,
      Tuesday: true,
      Wednesday: true,
      Thursday: true,
      Friday: true,
      Saturday: false,
      Sunday: false,
    },
    emails_per_day: null,
    track_open: false,
    track_click: true,
    track_reply: true,
    track_attachment: false,
    is_automated: true,
  }
}
const form = ref(makeBlankForm())

// Reset on each open. Without this, leftover state from a Cancel-then-
// reopen could confuse admins (they'd see the previous fields half-
// filled).
watch(show, (open) => {
  if (open) {
    form.value = makeBlankForm()
    emailAccountOption.value = null
    errorMessage.value = ''
  }
})

// Email account picker — same backend method the Module 1 send
// composer uses. Returns the team's Autoklose-side mailboxes; admins
// can pick one or leave the picker empty to let Autoklose use its
// default mailbox.
const emailAccounts = createResource({
  url: 'firmadapt_crm.integrations.autoklose.api.list_email_accounts',
  auto: true,
})
const emailAccountOptions = computed(() => {
  return (emailAccounts.data || []).map((a) => ({
    label: a.name || `#${a.id}`,
    value: String(a.id),
    description: a.is_default ? 'default' : '',
    _row: a,
  }))
})
const emailAccountOption = ref(null)

const errorMessage = ref('')
const creating = ref(false)

async function runCreate(close) {
  errorMessage.value = ''
  if (!form.value.name?.trim()) {
    errorMessage.value = __('Campaign name is required.')
    return
  }
  if (!form.value.start_date) {
    errorMessage.value = __('Start date is required.')
    return
  }

  // Translate the SPA form shape to the backend args. Send the
  // sending_days object as-is (the backend `_coerce_sending_days`
  // accepts the dict shape directly). email_account_id is the bare
  // numeric id pulled from the Autocomplete option's `.value`.
  const payload = {
    name: form.value.name.trim(),
    start_date: form.value.start_date,
    timezone: form.value.timezone?.trim() || undefined,
    work_hours_from: form.value.work_hours_from || undefined,
    work_hours_to: form.value.work_hours_to || undefined,
    sending_days: form.value.sending_days,
    emails_per_day:
      form.value.emails_per_day == null || form.value.emails_per_day === ''
        ? undefined
        : Number(form.value.emails_per_day),
    track_open: form.value.track_open ? 1 : 0,
    track_click: form.value.track_click ? 1 : 0,
    track_reply: form.value.track_reply ? 1 : 0,
    track_attachment: form.value.track_attachment ? 1 : 0,
    is_automated: form.value.is_automated ? 1 : 0,
    email_account_id: emailAccountOption.value?.value || undefined,
  }

  creating.value = true
  try {
    const resp = await call(
      'firmadapt_crm.integrations.autoklose.campaign_authoring.create_campaign',
      payload,
    )
    emit('created', resp)
    close?.()
  } catch (e) {
    errorMessage.value =
      e?.messages?.join(', ') ||
      e?.message ||
      __('Campaign creation failed.')
  } finally {
    creating.value = false
  }
}
</script>
