<!--
  FirmAdapt Twilio click-to-call — Phase 1.

  Renders a "Call" button on the Lead detail page header. Clicking it
  asks the server to place a Twilio call: the rep's phone rings first,
  then Twilio bridges to the Lead's phone when the rep answers.

  Visibility gates (all must pass):
    - Caller has the `Autoklose User` role (we reuse the same role for
      Twilio per the integration spec — outbound contact rights are a
      single permission bucket).
    - Twilio Settings is `enabled` AND credentials are configured.
    - Lead has a phone number (mobile_no or phone).

  Server is the source of truth — same checks run there. This is a UX hide
  to keep the header tidy.
-->
<template>
  <!-- Hide entirely when role / enabled / configured gates fail. -->
  <template v-if="visible">
    <!-- Disabled-with-tooltip variant when the lead is unreachable. -->
    <Tooltip
      v-if="!leadPhone || frozen"
      :text="disabledTooltip"
    >
      <Button
        :label="__('Call')"
        variant="subtle"
        theme="gray"
        :disabled="true"
      >
        <template #prefix>
          <PhoneIcon class="h-4 w-4" />
        </template>
      </Button>
    </Tooltip>
    <Button
      v-else
      :label="__('Call')"
      variant="solid"
      theme="blue"
      :loading="calling"
      @click="confirmOpen = true"
    >
      <template #prefix>
        <PhoneIcon class="h-4 w-4" />
      </template>
    </Button>
  </template>

  <!-- Confirm dialog — kept simple. Explains the two-leg flow so the user
       isn't surprised when their own phone rings. -->
  <Dialog
    v-model="confirmOpen"
    :options="{
      title: __('Place call via Twilio'),
      actions: [
        {
          label: __('Call now'),
          variant: 'solid',
          theme: 'blue',
          loading: calling,
          onClick: onCall,
        },
        {
          label: __('Cancel'),
          onClick: () => (confirmOpen = false),
        },
      ],
    }"
  >
    <template #body-content>
      <p class="text-base text-ink-gray-7">
        {{ confirmBody }}
      </p>
      <p class="mt-2 text-sm text-ink-gray-5">
        {{
          __(
            'Twilio will ring your phone first. When you answer, the call connects to {0}.',
            [leadPhone || __('the lead')],
          )
        }}
      </p>
    </template>
  </Dialog>
</template>

<script setup>
import PhoneIcon from '@/components/Icons/PhoneIcon.vue'
import {
  Button,
  Dialog,
  Tooltip,
  call,
  createResource,
  toast,
} from 'frappe-ui'
import { computed, ref } from 'vue'

const props = defineProps({
  // Pass the entire Lead doc — we read mobile_no / phone / first_name /
  // custom_lead_email_conflict_frozen off it. `name` is the doc id.
  leadDoc: { type: Object, required: true },
})

const emit = defineEmits(['initiated'])

// ----- Role + config gates -------------------------------------------------
const autokloseUserFlag = ref(false)
createResource({
  url: 'firmadapt_crm.permissions.is_autoklose_user',
  auto: true,
  onSuccess: (v) => (autokloseUserFlag.value = !!v),
  onError: () => (autokloseUserFlag.value = false),
})

// One probe per mount — tells us whether the integration is enabled +
// credentials are filled. Cheap, non-sensitive.
const config = ref({ enabled: false, configured: false })
createResource({
  url: 'firmadapt_crm.integrations.twilio.api.get_click_to_call_config',
  auto: true,
  onSuccess: (v) => (config.value = v || { enabled: false, configured: false }),
  onError: () => (config.value = { enabled: false, configured: false }),
})

// ----- Derived state -------------------------------------------------------
const leadPhone = computed(
  () =>
    (props.leadDoc?.mobile_no || props.leadDoc?.phone || '').toString().trim(),
)

const frozen = computed(
  () => !!props.leadDoc?.custom_lead_email_conflict_frozen,
)

const visible = computed(() => {
  if (!autokloseUserFlag.value) return false
  if (!config.value?.enabled) return false
  if (!config.value?.configured) return false
  return true
})

const disabledTooltip = computed(() => {
  if (frozen.value)
    return __('This Lead is frozen pending Lead Email Conflict resolution.')
  if (!leadPhone.value) return __('Lead has no phone number.')
  return ''
})

const confirmBody = computed(() => {
  const name = (props.leadDoc?.first_name || props.leadDoc?.name || '').toString()
  if (name) {
    return __('Call {0} at {1}?', [name, leadPhone.value])
  }
  return __('Call {0}?', [leadPhone.value])
})

// ----- Action ---------------------------------------------------------------
const confirmOpen = ref(false)
const calling = ref(false)

async function onCall() {
  if (calling.value) return
  calling.value = true
  try {
    const result = await call(
      'firmadapt_crm.integrations.twilio.api.initiate_call',
      { lead_name: props.leadDoc?.name },
    )
    toast.create({
      message: __(
        'Calling {0}… Your phone will ring shortly.',
        [(props.leadDoc?.first_name || __('the lead')).toString()],
      ),
      type: 'success',
    })
    emit('initiated', result)
    confirmOpen.value = false
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        __('Twilio click-to-call failed.'),
      type: 'error',
    })
  } finally {
    calling.value = false
  }
}
</script>
