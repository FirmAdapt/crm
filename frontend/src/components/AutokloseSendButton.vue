<template>
  <!-- Hidden entirely when:
       - Doctype isn't CRM Lead (Autoklose is Lead-centric)
       - Caller has no Autoklose role
       - The Lead has no email address (Autoklose requires one)
       - There are no Autoklose email accounts connected -->
  <div v-if="visible" class="flex items-center">
    <!-- Tooltip wraps the button so hover events fire on the wrapper
         (not the button itself). Necessary because a disabled HTML
         <button> swallows pointer events — frappe-ui Button's own
         :tooltip prop never mounts when the button is disabled, which
         is exactly the state we most need to explain ("Body is
         required" / "Autoklose's single-send API doesn't accept
         attachments" / etc.). -->
    <Tooltip :text="tooltip">
      <Button
        :loading="sending"
        :disabled="disabled"
        :variant="'outline'"
        class="rounded-r-none"
        @click="onSend"
      >
        <template #prefix>
          <FeatherIcon name="send" class="h-4 w-4" />
        </template>
        <span>{{ buttonLabel }}</span>
      </Button>
    </Tooltip>

    <!-- Email-account picker. When only 1 account exists, hidden — the
         single account is implicit. Clicking the chevron opens a small
         menu of accounts; selecting one updates `selectedAccountId` and
         labels the primary button accordingly. -->
    <Dropdown
      v-if="emailAccounts.data?.length > 1"
      :options="accountDropdownOptions"
      placement="top"
    >
      <Button
        :variant="'outline'"
        :disabled="disabled"
        class="rounded-l-none border-l-0 px-2"
      >
        <FeatherIcon name="chevron-up" class="h-4 w-4" />
      </Button>
    </Dropdown>
  </div>
</template>

<script setup>
import {
  Button,
  Dropdown,
  FeatherIcon,
  Tooltip,
  call,
  createResource,
  toast,
} from 'frappe-ui'
import { computed, ref, watch } from 'vue'

const props = defineProps({
  // The Lead's `name` (doc id) — passed straight to the server method.
  leadName: { type: String, required: true },
  // The Lead's email — used only to gate visibility (server enforces too).
  leadEmail: { type: String, default: '' },
  // CRM Lead / CRM Deal / etc. Autoklose path is Lead-only for now.
  doctype: { type: String, default: '' },
  // Live subject + body from the parent EmailEditor. Reactive so the
  // disabled state tracks empty content.
  subject: { type: String, default: '' },
  body: { type: String, default: '' },
  // Has-attachments flag from the parent. Autoklose's /api/send doesn't
  // accept files, so we disable the button (with tooltip) when files
  // are attached and let the user fall back to the standard Send.
  hasAttachments: { type: Boolean, default: false },
  // Module 0b conflict freeze. Mirror of push_lead's gate.
  frozen: { type: [Number, Boolean], default: 0 },
})

const emit = defineEmits(['sent'])

// ----- Role + email-account resources --------------------------------------
const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

const emailAccounts = createResource({
  url: 'firmadapt_crm.integrations.autoklose.api.list_email_accounts',
  auto: true,
  onSuccess: (rows) => {
    if (Array.isArray(rows) && rows.length) {
      // Default-first ordering is enforced server-side; pick that one
      // unless the user explicitly clicks a different option.
      const def = rows.find((r) => r.is_default) || rows[0]
      selectedAccountId.value = def?.id ?? null
    }
  },
})

const selectedAccountId = ref(null)

const accountDropdownOptions = computed(() => {
  const rows = emailAccounts.data || []
  return rows.map((r) => ({
    label: r.name + (r.is_default ? __(' (default)') : ''),
    onClick: () => (selectedAccountId.value = r.id),
  }))
})

// ----- Visibility + disabled state -----------------------------------------
const visible = computed(() => {
  if (props.doctype !== 'CRM Lead') return false
  if (!autokloseUserFlag.value) return false
  if (!props.leadEmail) return false
  if (!emailAccounts.data?.length) return false
  return true
})

const disabled = computed(() => {
  if (sending.value) return true
  if (props.frozen) return true
  if (props.hasAttachments) return true
  if (!props.subject?.trim()) return true
  if (!props.body || props.body === '<p></p>') return true
  return false
})

const tooltip = computed(() => {
  if (props.frozen) {
    return __('This Lead is frozen pending Lead Email Conflict resolution.')
  }
  if (props.hasAttachments) {
    return __(
      "Autoklose's single-send API doesn't accept attachments. Use the standard Send button instead.",
    )
  }
  if (!props.subject?.trim()) return __('Subject is required.')
  if (!props.body || props.body === '<p></p>') return __('Body is required.')
  return __(
    'Sends a one-off email through Autoklose. Replies, opens, and clicks are tracked by Autoklose and flow back as Communication entries.',
  )
})

const buttonLabel = computed(() => {
  if (sending.value) return __('Sending…')
  // When 2+ accounts exist, include the picked account's name so the
  // user knows which mailbox is on the send line.
  if (emailAccounts.data && emailAccounts.data.length > 1) {
    const acc = emailAccounts.data.find((a) => a.id === selectedAccountId.value)
    return __('Send via Autoklose') + (acc ? ` · ${acc.name}` : '')
  }
  return __('Send via Autoklose')
})

// ----- Send action ----------------------------------------------------------
const sending = ref(false)
async function onSend() {
  if (disabled.value) return
  sending.value = true
  try {
    const result = await call(
      'firmadapt_crm.integrations.autoklose.api.send_single_email',
      {
        lead_name: props.leadName,
        subject: props.subject,
        body: props.body,
        email_account_id: selectedAccountId.value,
      },
    )
    toast.create({
      message: __('Email sent via Autoklose.'),
      type: 'success',
    })
    emit('sent', result)
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Send via Autoklose failed.'),
      type: 'error',
    })
  } finally {
    sending.value = false
  }
}

// If the Lead changes (parent navigates), reset selectedAccountId so the
// default-pick logic re-runs after the next email-accounts response.
watch(
  () => props.leadName,
  () => {
    selectedAccountId.value = null
    emailAccounts.fetch()
  },
)
</script>
