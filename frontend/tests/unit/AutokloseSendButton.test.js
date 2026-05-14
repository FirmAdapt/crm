// Tests for AutokloseSendButton.vue.
//
// Surface under test:
// - visibility gates (CRM Lead + Autoklose role + has email + ≥1 email
//   account)
// - disabled when subject OR body is empty (and the tooltip-fallback
//   workaround: the Button is wrapped in <Tooltip> because frappe-ui
//   Button's :tooltip prop doesn't fire when the button is disabled)
// - click → call('send_single_email', { lead_name, subject, body, ... })
// - emits 'sent' on success

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// ─── Mocks ──────────────────────────────────────────────────────────
// We need fine control over what `createResource` returns for the two
// resources the component creates (is_autoklose_user + list_email_accounts).
// vi.hoisted is required because vi.mock is hoisted above any non-
// hoisted const.
const {
  callMock,
  toastMock,
  resourceFactory,
  // Refs to mutate the resource state between tests.
  state,
} = vi.hoisted(() => {
  // Captured side-state, exposed via `state` so each test can flip
  // visibility + accounts list without re-stubbing.
  const state = {
    autokloseUser: true,
    emailAccounts: [{ id: 'acct-1', name: 'Inbox', is_default: 1 }],
  }
  const callMock = vi.fn(() => Promise.resolve({ ok: true }))
  const toastMock = {
    create: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }
  // createResource is called twice (autokloseUserFlag, emailAccounts).
  // The SFC distinguishes them by `url`. We match on URL and feed the
  // right onSuccess.
  const resourceFactory = vi.fn((opts) => {
    const fakeRes = { data: null, fetch: vi.fn(), reload: vi.fn() }
    if (opts.url === 'firmadapt_crm.permissions.is_autoklose_user') {
      // Immediate sync onSuccess — happens at construction time per
      // the `auto: true` flag.
      if (typeof opts.onSuccess === 'function') {
        Promise.resolve().then(() => opts.onSuccess(state.autokloseUser))
      }
    } else if (
      opts.url ===
      'firmadapt_crm.integrations.autoklose.api.list_email_accounts'
    ) {
      fakeRes.data = state.emailAccounts
      if (typeof opts.onSuccess === 'function') {
        Promise.resolve().then(() => opts.onSuccess(state.emailAccounts))
      }
    }
    return fakeRes
  })
  return { callMock, toastMock, resourceFactory, state }
})

vi.mock('frappe-ui', () => ({
  Button: {
    name: 'Button',
    props: ['loading', 'disabled', 'variant'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" data-test="ak-btn" ' +
      '@click="$emit(\'click\', $event)">' +
      '<slot name="prefix" /><slot /></button>',
  },
  Dropdown: {
    name: 'Dropdown',
    props: ['options', 'placement'],
    template: '<div class="dropdown-stub"><slot /></div>',
  },
  FeatherIcon: {
    name: 'FeatherIcon',
    props: ['name'],
    template: '<span class="feather-stub" />',
  },
  Tooltip: {
    name: 'Tooltip',
    props: ['text'],
    template: '<div class="tooltip-stub" :data-tooltip="text"><slot /></div>',
  },
  call: callMock,
  createResource: resourceFactory,
  toast: toastMock,
}))

import AutokloseSendButton from '@/components/AutokloseSendButton.vue'

function makeWrapper(overrides = {}) {
  return mount(AutokloseSendButton, {
    props: {
      leadName: 'CRM-LEAD-2026-00001',
      leadEmail: 'lead@example.com',
      doctype: 'CRM Lead',
      subject: 'Hello',
      body: '<p>Hi there!</p>',
      hasAttachments: false,
      frozen: 0,
      ...overrides,
    },
  })
}

describe('AutokloseSendButton', () => {
  beforeEach(() => {
    callMock.mockClear()
    toastMock.create.mockClear()
    state.autokloseUser = true
    state.emailAccounts = [
      { id: 'acct-1', name: 'Inbox', is_default: 1 },
    ]
  })

  // ─── Visibility gates ─────────────────────────────────────────────
  describe('visibility', () => {
    it('renders when all four gates pass', async () => {
      const wrapper = makeWrapper()
      // createResource onSuccess fires on a microtask; wait for it.
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="ak-btn"]').exists()).toBe(true)
    })

    it('hides when doctype is not CRM Lead', async () => {
      const wrapper = makeWrapper({ doctype: 'CRM Deal' })
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="ak-btn"]').exists()).toBe(false)
    })

    it('hides when user lacks the Autoklose role', async () => {
      state.autokloseUser = false
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="ak-btn"]').exists()).toBe(false)
    })

    it('hides when the Lead has no email', async () => {
      const wrapper = makeWrapper({ leadEmail: '' })
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="ak-btn"]').exists()).toBe(false)
    })

    it('hides when there are zero email accounts', async () => {
      state.emailAccounts = []
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="ak-btn"]').exists()).toBe(false)
    })
  })

  // ─── Disabled state ────────────────────────────────────────────────
  describe('disabled state', () => {
    it('disabled when subject is empty', async () => {
      const wrapper = makeWrapper({ subject: '' })
      await flushPromises()
      await nextTick()
      const btn = wrapper.find('[data-test="ak-btn"]')
      expect(btn.exists()).toBe(true)
      expect(btn.attributes('disabled')).toBeDefined()
    })

    it('disabled when body is empty', async () => {
      const wrapper = makeWrapper({ body: '' })
      await flushPromises()
      await nextTick()
      const btn = wrapper.find('[data-test="ak-btn"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })

    it('disabled when body is an empty TipTap paragraph (<p></p>)', async () => {
      // The Email editor (TipTap) emits `<p></p>` for "empty" bodies —
      // the SFC treats that as empty explicitly.
      const wrapper = makeWrapper({ body: '<p></p>' })
      await flushPromises()
      await nextTick()
      const btn = wrapper.find('[data-test="ak-btn"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  // ─── Tooltip wrapper (gotcha guard) ───────────────────────────────
  describe('Tooltip wrapper', () => {
    it('wraps the Button in a Tooltip so hover hints work when disabled', async () => {
      // Per the comment block in the SFC: a disabled HTML <button>
      // swallows pointer events, so frappe-ui Button's own :tooltip
      // prop never mounts. Workaround: outer <Tooltip>.
      const wrapper = makeWrapper({ subject: '' })
      await flushPromises()
      await nextTick()
      const tooltip = wrapper.findComponent({ name: 'Tooltip' })
      expect(tooltip.exists()).toBe(true)
      // The tooltip text should reflect the disabled reason (Subject
      // is required) when subject is empty.
      expect(tooltip.props('text')).toContain('Subject')
    })

    it('tooltip text explains the body-required case', async () => {
      const wrapper = makeWrapper({ body: '' })
      await flushPromises()
      await nextTick()
      const tooltip = wrapper.findComponent({ name: 'Tooltip' })
      expect(tooltip.props('text')).toContain('Body')
    })
  })

  // ─── Click → call → emit('sent') ─────────────────────────────────
  describe('send flow', () => {
    it('clicking the button invokes call() with send_single_email', async () => {
      callMock.mockResolvedValueOnce({ ok: true, communication: 'COMM-1' })
      const wrapper = makeWrapper({
        subject: 'Quick follow-up',
        body: '<p>Body content</p>',
      })
      await flushPromises()
      await nextTick()
      await wrapper.find('[data-test="ak-btn"]').trigger('click')
      await flushPromises()

      expect(callMock).toHaveBeenCalledTimes(1)
      const [endpoint, args] = callMock.mock.calls[0]
      expect(endpoint).toBe(
        'firmadapt_crm.integrations.autoklose.api.send_single_email',
      )
      expect(args.lead_name).toBe('CRM-LEAD-2026-00001')
      expect(args.subject).toBe('Quick follow-up')
      expect(args.body).toBe('<p>Body content</p>')
      // The default-pick path resolves selectedAccountId to acct-1.
      expect(args.email_account_id).toBe('acct-1')
    })

    it("emits 'sent' with the backend result on success", async () => {
      callMock.mockResolvedValueOnce({ ok: true, communication: 'COMM-7' })
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      await wrapper.find('[data-test="ak-btn"]').trigger('click')
      await flushPromises()

      const emitted = wrapper.emitted('sent')
      expect(emitted).toBeTruthy()
      expect(emitted[0][0]).toEqual({ ok: true, communication: 'COMM-7' })
    })
  })
})
