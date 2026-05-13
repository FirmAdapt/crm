<template>
  <div class="flex justify-between gap-3 border-t px-4 py-2.5 sm:px-10">
    <div class="flex gap-1.5">
      <Button
        variant="ghost"
        :class="[
          showEmailBox ? '!bg-surface-gray-4 hover:!bg-surface-gray-3' : '',
        ]"
        :label="__('Reply')"
        :iconLeft="Email2Icon"
        @click="toggleEmailBox()"
      />
      <Button
        variant="ghost"
        :label="__('Comment')"
        :class="[
          showCommentBox ? '!bg-surface-gray-4 hover:!bg-surface-gray-3' : '',
        ]"
        :iconLeft="CommentIcon"
        @click="toggleCommentBox()"
      />
    </div>
  </div>
  <div
    v-show="showEmailBox"
    @keydown.ctrl.enter.capture.stop="submitEmail"
    @keydown.meta.enter.capture.stop="submitEmail"
  >
    <EmailEditor
      ref="newEmailEditor"
      v-model:content="newEmail"
      v-model="doc"
      v-model:attachments="attachments"
      :submitButtonProps="{
        variant: 'solid',
        onClick: submitEmail,
        disabled: emailEmpty,
      }"
      :discardButtonProps="{
        onClick: async () => {
          await deleteAttachedFiles()
          showEmailBox = false
          newEmailEditor.subject = subject
          newEmailEditor.toEmails = doc.email ? [doc.email] : []
          newEmailEditor.ccEmails = []
          newEmailEditor.bccEmails = []
          newEmailEditor.cc = false
          newEmailEditor.bcc = false
          newEmail = ''
        },
      }"
      :editable="showEmailBox"
      :doctype="doctype"
      :subject="subject"
      :placeholder="
        __('Hi John, \n\nCan you please provide more details on this...')
      "
    >
      <!-- FirmAdapt Module 1 (Phase A.2 / Item 6.C.B): "Send via
           Autoklose" path next to the standard Send button. The button
           component self-gates (Lead-only doctype, Autoklose role,
           Lead has email, accounts connected) so on Deal/Contact
           pages or for non-Autoklose users it renders nothing. -->
      <template #extra-actions>
        <AutokloseSendButton
          :leadName="doc.name"
          :leadEmail="doc.email"
          :doctype="doctype"
          :subject="newEmailEditor?.subject || ''"
          :body="newEmail"
          :hasAttachments="attachments?.length > 0"
          :frozen="!!doc.custom_lead_email_conflict_frozen"
          @sent="onAutokloseSent"
        />
      </template>
    </EmailEditor>
  </div>
  <div v-show="showCommentBox">
    <CommentBox
      ref="newCommentEditor"
      v-model:content="newComment"
      v-model="doc"
      v-model:attachments="attachments"
      :submitButtonProps="{
        variant: 'solid',
        onClick: submitComment,
        disabled: commentEmpty,
      }"
      :discardButtonProps="{
        onClick: async () => {
          await deleteAttachedFiles()
          showCommentBox = false
          newComment = ''
        },
      }"
      :editable="showCommentBox"
      :doctype="doctype"
      :placeholder="__('@John, can you please check this?')"
    />
  </div>
</template>

<script setup>
import EmailEditor from '@/components/EmailEditor.vue'
// FirmAdapt Module 1 (Phase A.2 / Item 6.C.B) — secondary "Send via
// Autoklose" path on the Lead's email composer.
import AutokloseSendButton from '@/components/AutokloseSendButton.vue'
import CommentBox from '@/components/CommentBox.vue'
import CommentIcon from '@/components/Icons/CommentIcon.vue'
import Email2Icon from '@/components/Icons/Email2Icon.vue'
import { usersStore } from '@/stores/users'
import { useStorage } from '@vueuse/core'
import { useOnboarding, useTelemetry } from 'frappe-ui/frappe'
import { call, createResource, toast } from 'frappe-ui'
import { ref, watch, computed } from 'vue'

const props = defineProps({
  doctype: { type: String, default: 'CRM Lead' },
})

const doc = defineModel({ type: Object, default: () => ({}) })
const reload = defineModel('reload', { type: Boolean })

const emit = defineEmits(['scroll'])

const { getUser } = usersStore()
const { updateOnboardingStep } = useOnboarding('frappecrm')
const { capture } = useTelemetry()

const showEmailBox = ref(false)
const showCommentBox = ref(false)
const newEmail = useStorage(
  `emailBoxContent-${getUser().email}-${props.doctype}-${doc.value.name}`,
  '',
)
const newComment = useStorage(
  `commentBoxContent-${getUser().email}-${props.doctype}-${doc.value.name}`,
  '',
)
const newEmailEditor = ref(null)
const newCommentEditor = ref(null)

const attachments = useStorage(
  `attachments-${getUser().email}-${props.doctype}-${doc.value.name}`,
  [],
  localStorage,
  {
    serializer: {
      read: (v) => (v ? JSON.parse(v) : []),
      write: (v) => JSON.stringify(v),
    },
  },
)

const subject = computed(() => {
  let prefix = ''
  if (doc.value?.lead_name) {
    prefix = doc.value.lead_name
  } else if (doc.value?.organization) {
    prefix = doc.value.organization
  }
  return `${prefix} (#${doc.value.name})`
})

const signature = createResource({
  url: 'crm.api.get_user_signature',
  cache: 'user-email-signature',
  auto: true,
})

function setSignature(editor) {
  if (!signature.data) return
  signature.data = signature.data.replace(/\n/g, '<br>')
  let emailContent = editor.getHTML()
  emailContent = emailContent.startsWith('<p></p>')
    ? emailContent.slice(7)
    : emailContent
  editor.commands.setContent(signature.data + emailContent)
  editor.commands.focus('start')
}

watch(
  () => showEmailBox.value,
  (value) => {
    if (value) {
      let editor = newEmailEditor.value.editor
      editor.commands.focus()
      setSignature(editor)
    }
  },
)

watch(
  () => showCommentBox.value,
  (value) => {
    if (value) {
      newCommentEditor.value.editor.commands.focus()
    }
  },
)

const commentEmpty = computed(() => {
  return !newComment.value || newComment.value === '<p></p>'
})

const emailEmpty = computed(() => {
  return (
    !newEmail.value ||
    newEmail.value === '<p></p>' ||
    !newEmailEditor.value?.toEmails?.length
  )
})

async function sendMail() {
  let fromEmail = newEmailEditor.value.fromEmail || getUser().email
  let recipients = newEmailEditor.value.toEmails
  let subject = newEmailEditor.value.subject
  let cc = newEmailEditor.value.ccEmails || []
  let bcc = newEmailEditor.value.bccEmails || []

  if (attachments.value.length) {
    capture('email_attachments_added')
  }
  await call('frappe.core.doctype.communication.email.make', {
    recipients: recipients.join(', '),
    attachments: attachments.value.map((x) => x.name),
    cc: cc.join(', '),
    bcc: bcc.join(', '),
    subject: subject,
    content: newEmail.value,
    doctype: props.doctype,
    name: doc.value.name,
    send_email: 1,
    sender: fromEmail,
    sender_full_name: getUser()?.full_name || undefined,
  })
}

async function sendComment() {
  let _attachments = attachments.value.length
    ? attachments.value.map((x) => x.name)
    : []

  let comment = await call('crm.api.comment.add_comment', {
    reference_doctype: props.doctype,
    reference_name: doc.value.name,
    content: newComment.value,
    attachments: _attachments,
  })

  if (comment && attachments.value.length) {
    capture('comment_attachments_added')
  }
}

async function deleteAttachedFiles() {
  if (!attachments.value || attachments.value.length === 0) return

  const deletePromises = attachments.value.map(async (file) => {
    try {
      await call('frappe.client.delete', {
        doctype: 'File',
        name: file.name,
      })
    } catch (error) {
      console.warn(`Failed to delete file ${file.name}:`, error)
    }
  })

  await Promise.all(deletePromises)

  attachments.value = []
}

async function submitEmail() {
  if (emailEmpty.value) return
  showEmailBox.value = false
  await toast.promise(sendMail(), {
    loading: __('Sending email...'),
    success: __('Email sent'),
    error: (e) => e?.messages?.[0] || __('Failed to send email!'),
  })
  newEmail.value = ''
  attachments.value = []
  reload.value = true
  emit('scroll')
  capture('email_sent', { doctype: props.doctype })
  updateOnboardingStep('send_first_email')
}

// FirmAdapt Module 1 (Phase A.2 / Item 6.C.B): success handler for the
// Autoklose-path send. Mirrors submitEmail's cleanup — close the editor,
// clear the buffer, trigger an Activities reload so the new
// Communication row (logged server-side by send_single_email) shows up
// in the timeline. Toast is owned by AutokloseSendButton itself.
function onAutokloseSent() {
  showEmailBox.value = false
  newEmail.value = ''
  attachments.value = []
  reload.value = true
  emit('scroll')
  capture('email_sent_via_autoklose', { doctype: props.doctype })
}

async function submitComment() {
  if (commentEmpty.value) return
  showCommentBox.value = false
  await toast.promise(sendComment(), {
    loading: __('Sending comment...'),
    success: __('Comment sent'),
    error: (e) => e?.messages?.[0] || __('Failed to send comment!'),
  })
  newComment.value = ''
  attachments.value = []
  reload.value = true
  emit('scroll')
  capture('comment_sent', { doctype: props.doctype })
  updateOnboardingStep('add_first_comment')
}

function toggleEmailBox() {
  if (showCommentBox.value) {
    showCommentBox.value = false
  }
  showEmailBox.value = !showEmailBox.value
}

function toggleCommentBox() {
  if (showEmailBox.value) {
    showEmailBox.value = false
  }
  showCommentBox.value = !showCommentBox.value
}

defineExpose({
  show: showEmailBox,
  showComment: showCommentBox,
  editor: newEmailEditor,
})
</script>
