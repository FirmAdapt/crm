<template>
  <!--
    Module 3 — Sequence step authoring modal.

    Single-form Dialog used for both CREATE (step prop = null) and EDIT
    (step prop = the step row). Body is a plain textarea — Module 3
    ships without a rich-text editor on purpose; v0.12+ can introduce
    one once we know what the team's authoring habits look like.

    Subject + body are required for create; on edit, an empty value
    means "don't update this field" — we send only the keys that
    actually changed. send_after_days has min=1 (Autoklose 422s on 0).
  -->
  <Dialog
    v-model="show"
    :options="{
      title: isEdit
        ? __('Edit sequence step')
        : __('Add sequence step'),
      size: 'xl',
      actions: [
        {
          label: isEdit ? __('Save changes') : __('Create step'),
          variant: 'solid',
          theme: 'blue',
          loading: saving,
          onClick: runSave,
        },
        { label: __('Cancel') },
      ],
    }"
  >
    <template #body-content>
      <div class="space-y-4">
        <div>
          <label class="mb-1 block text-sm font-medium text-ink-gray-9">
            {{ __('Subject') }}
            <span class="text-ink-red-4">*</span>
          </label>
          <FormControl
            v-model="form.subject"
            type="text"
            :placeholder="__('e.g. Quick follow-up on our chat')"
          />
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Send after (days)') }}
              <span class="text-ink-red-4">*</span>
            </label>
            <FormControl
              v-model.number="form.send_after_days"
              type="number"
              :min="1"
            />
            <div class="mt-1 text-xs text-ink-gray-5">
              {{ __('Must be at least 1. Autoklose rejects 0.') }}
            </div>
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-ink-gray-9">
              {{ __('Preview text') }}
            </label>
            <FormControl
              v-model="form.preview_text"
              type="text"
              :maxlength="140"
              :placeholder="__('Optional preheader (max 140 chars)')"
            />
          </div>
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-ink-gray-9">
            {{ __('Body (HTML)') }}
            <span class="text-ink-red-4">*</span>
          </label>
          <textarea
            v-model="form.body"
            rows="12"
            spellcheck="true"
            class="w-full rounded border border-outline-gray-2 bg-surface-white px-3 py-2 font-mono text-xs text-ink-gray-9 focus:border-outline-gray-4 focus:outline-none"
            :placeholder="bodyPlaceholder"
          />
          <div class="mt-1 text-xs text-ink-gray-5">
            {{ helpText }}
          </div>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { Dialog, FormControl, call, toast } from 'frappe-ui'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps({
  // null → CREATE mode. Otherwise a step row from doc.sequence_steps;
  // editable keys we care about: step_id, subject, body_html,
  // send_after_days, preview_text.
  step: { type: Object, default: null },
  campaignId: { type: String, required: true },
})

const emit = defineEmits(['saved'])

const show = defineModel({ type: Boolean })

const isEdit = computed(() => !!props.step?.step_id)

// Placeholders + help text live in script setup because the template
// parser flags Vue `{{...}}` mustaches even inside string literals
// (it tries to interpret them as inline interpolations and dies
// mid-expression). Building them in JS dodges that.
const bodyPlaceholder = '<p>Hi {' + '{first_name}},</p>\n<p>...</p>'
const helpText = __(
  'Plain HTML. Autoklose merge tokens such as {first_name} render server-side at send time.',
)

// Local form state — flat reactive object so v-model writes feel
// natural and resetForm() is a single replacement.
const form = reactive({
  subject: '',
  body: '',
  send_after_days: 1,
  preview_text: '',
})

function resetForm() {
  if (props.step) {
    form.subject = props.step.subject || ''
    // The local doctype field is body_html; Autoklose's API key is
    // `body`. We keep the form key `body` (the API name) to make the
    // POST payload mapping obvious.
    form.body = props.step.body_html || ''
    form.send_after_days = props.step.send_after_days || 1
    form.preview_text = props.step.preview_text || ''
  } else {
    form.subject = ''
    form.body = ''
    form.send_after_days = 1
    form.preview_text = ''
  }
}

// Re-seed the form when the dialog re-opens OR when the step prop
// changes (parent may swap edit-target without closing the modal).
watch(
  [show, () => props.step],
  ([open]) => {
    if (open) resetForm()
  },
  { immediate: true },
)

const saving = ref(false)

async function runSave(close) {
  const subject = (form.subject || '').trim()
  const body = (form.body || '').trim()
  if (!subject) {
    toast.create({ message: __('Subject is required.'), type: 'error' })
    return
  }
  if (!body) {
    toast.create({ message: __('Body is required.'), type: 'error' })
    return
  }
  const days = Number(form.send_after_days)
  if (!Number.isFinite(days) || days < 1) {
    toast.create({
      message: __('Send after days must be at least 1.'),
      type: 'error',
    })
    return
  }

  saving.value = true
  try {
    if (isEdit.value) {
      await call(
        'firmadapt_crm.integrations.autoklose.step_authoring.update_step',
        {
          campaign_id: props.campaignId,
          step_id: props.step.step_id,
          subject,
          body,
          send_after_days: days,
          preview_text: form.preview_text || '',
        },
      )
      toast.create({
        message: __('Sequence step updated.'),
        type: 'success',
      })
    } else {
      await call(
        'firmadapt_crm.integrations.autoklose.step_authoring.create_step',
        {
          campaign_id: props.campaignId,
          subject,
          body,
          send_after_days: days,
          preview_text: form.preview_text || null,
        },
      )
      toast.create({
        message: __('Sequence step created.'),
        type: 'success',
      })
    }
    emit('saved')
    close?.()
  } catch (e) {
    toast.create({
      message:
        e?.messages?.join(', ') ||
        e?.message ||
        e?._server_messages ||
        __('Save failed.'),
      type: 'error',
    })
  } finally {
    saving.value = false
  }
}
</script>
