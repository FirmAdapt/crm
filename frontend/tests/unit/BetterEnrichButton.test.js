// Tests for BetterEnrichButton.vue.
//
// Surface under test:
//   - Role gate: hidden when user lacks Autoklose User role.
//   - Integration gate: hidden when get_my_quota errors.
//   - Quota label suffix renders against each action.
//   - Suffix refreshes after a successful action (server may piggy-
//     back fresh `quota` in the response or we re-call get_my_quota).
//   - Per-action disabled state when quota exhausted.
//   - Per-action disabled state when prerequisite Lead field missing.
//
// We don't try to mount the real frappe-ui Dropdown DOM — the
// component exposes `actions` via defineExpose for exactly this kind
// of focused test (the dropdown tree is hard to drive in jsdom and
// adds nothing beyond verifying frappe-ui's own component). Visibility
// is verified via the rendered dropdown stub.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// ─── Mocks ──────────────────────────────────────────────────────────
// createResource is called twice (autokloseUserFlag, quota). We match
// on URL and route the test state accordingly.

const { callMock, toastMock, resourceFactory, state, quotaReloadMock } =
  vi.hoisted(() => {
    const state = {
      autokloseUser: true,
      // null → onError (integration not configured / disabled).
      quota: {
        email: {
          user_hourly_used: 3,
          user_hourly_limit: 10,
          user_daily_used: 12,
          user_daily_limit: 50,
        },
        phone: {
          user_hourly_used: 0,
          user_hourly_limit: 3,
          user_daily_used: 1,
          user_daily_limit: 10,
        },
        other: {
          user_hourly_used: 0,
          user_hourly_limit: 20,
          user_daily_used: 0,
          user_daily_limit: 100,
        },
        verify: {
          user_hourly_used: 0,
          user_hourly_limit: 30,
          user_daily_used: 0,
          user_daily_limit: 200,
        },
      },
    }
    const callMock = vi.fn(() => Promise.resolve({ ok: true }))
    const toastMock = {
      create: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
    }
    const quotaReloadMock = vi.fn()
    const resourceFactory = vi.fn((opts) => {
      const fakeRes = { data: null, fetch: vi.fn(), reload: vi.fn() }
      if (opts.url === 'firmadapt_crm.permissions.is_autoklose_user') {
        Promise.resolve().then(() => {
          if (state.autokloseUser) opts.onSuccess?.(true)
          else opts.onSuccess?.(false)
        })
      } else if (
        opts.url ===
        'firmadapt_crm.integrations.betterenrich.api.get_my_quota'
      ) {
        // Wire reload so refreshQuota() in the component is testable.
        fakeRes.reload = () => {
          quotaReloadMock()
          if (state.quota) opts.onSuccess?.(state.quota)
          else opts.onError?.(new Error('disabled'))
        }
        Promise.resolve().then(() => {
          if (state.quota) opts.onSuccess?.(state.quota)
          else opts.onError?.(new Error('disabled'))
        })
      }
      return fakeRes
    })
    return { callMock, toastMock, resourceFactory, state, quotaReloadMock }
  })

vi.mock('frappe-ui', () => ({
  Button: {
    name: 'Button',
    props: ['loading', 'disabled', 'variant', 'theme', 'label', 'iconLeft'],
    emits: ['click'],
    template:
      '<button :disabled="disabled" data-test="be-btn" ' +
      '@click="$emit(\'click\', $event)">' +
      '<slot name="prefix" />{{ label }}<slot /></button>',
  },
  Dropdown: {
    name: 'Dropdown',
    props: ['options', 'placement'],
    template:
      '<div class="dropdown-stub" data-test="be-dropdown"><slot /></div>',
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

import BetterEnrichButton from '@/components/BetterEnrichButton.vue'

function makeLead(overrides = {}) {
  return {
    name: 'CRM-LEAD-2026-00001',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@acme.test',
    website: 'https://acme.test',
    organization: 'Acme Inc',
    ...overrides,
  }
}

function makeWrapper(leadOverrides = {}) {
  return mount(BetterEnrichButton, {
    props: { leadDoc: makeLead(leadOverrides) },
  })
}

describe('BetterEnrichButton', () => {
  beforeEach(() => {
    callMock.mockClear()
    toastMock.create.mockClear()
    quotaReloadMock.mockClear()
    state.autokloseUser = true
    state.quota = {
      email: {
        user_hourly_used: 3,
        user_hourly_limit: 10,
        user_daily_used: 12,
        user_daily_limit: 50,
      },
      phone: {
        user_hourly_used: 0,
        user_hourly_limit: 3,
        user_daily_used: 1,
        user_daily_limit: 10,
      },
      other: {
        user_hourly_used: 0,
        user_hourly_limit: 20,
        user_daily_used: 0,
        user_daily_limit: 100,
      },
      verify: {
        user_hourly_used: 0,
        user_hourly_limit: 30,
        user_daily_used: 0,
        user_daily_limit: 200,
      },
    }
  })

  // ─── Visibility ──────────────────────────────────────────────────
  describe('visibility', () => {
    it('renders when role + integration both available', async () => {
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="be-dropdown"]').exists()).toBe(true)
    })

    it('hides when user lacks the Autoklose role', async () => {
      state.autokloseUser = false
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="be-dropdown"]').exists()).toBe(false)
    })

    it('hides when get_my_quota errors (integration not configured)', async () => {
      state.quota = null
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      expect(wrapper.find('[data-test="be-dropdown"]').exists()).toBe(false)
    })
  })

  // ─── Quota suffix rendering ───────────────────────────────────────
  describe('quota suffix', () => {
    it('appends hourly/daily counts to each action label', async () => {
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const actions = wrapper.vm.actions
      // find_work_email uses the email cost class: 3/10 hr, 12/50 today.
      const workEmail = actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(workEmail).toBeTruthy()
      expect(workEmail.label).toContain('(3/10 hr, 12/50 today)')
    })

    it('uses the right cost class per action (phone uses phone row)', async () => {
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const mobile = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find mobile phone'),
      )
      expect(mobile).toBeTruthy()
      // phone row: 0/3 hr, 1/10 today
      expect(mobile.label).toContain('(0/3 hr, 1/10 today)')
    })

    it('refreshes after a successful action (uses response.quota piggy-back)', async () => {
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      // The first call returns a new quota snapshot inline.
      callMock.mockResolvedValueOnce({
        ok: true,
        usage_log_name: 'BE-LOG-1',
        quota: {
          ...state.quota,
          email: {
            user_hourly_used: 4,
            user_hourly_limit: 10,
            user_daily_used: 13,
            user_daily_limit: 50,
          },
        },
      })
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      workEmail.onClick()
      await flushPromises()
      await nextTick()
      const refreshed = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(refreshed.label).toContain('(4/10 hr, 13/50 today)')
    })
  })

  // ─── Disabled states ──────────────────────────────────────────────
  describe('disabled actions', () => {
    it('disables the action when hourly quota is exhausted', async () => {
      state.quota.email.user_hourly_used = 10
      state.quota.email.user_hourly_limit = 10
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(workEmail.disabled).toBe(true)
      expect(workEmail.tooltip).toMatch(/Hourly quota reached/i)
    })

    it('disables the action when daily quota is exhausted', async () => {
      state.quota.email.user_daily_used = 50
      state.quota.email.user_daily_limit = 50
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(workEmail.disabled).toBe(true)
      expect(workEmail.tooltip).toMatch(/Daily quota reached/i)
    })

    it('disables the action when user is admin-disabled', async () => {
      state.quota.email = { scope: 'user_disabled', remaining: 0 }
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(workEmail.disabled).toBe(true)
      expect(workEmail.tooltip).toMatch(/disabled/i)
    })

    it('disables Find LinkedIn by email when Lead has no email', async () => {
      const wrapper = makeWrapper({ email: '' })
      await flushPromises()
      await nextTick()
      const linkedin = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find LinkedIn by email'),
      )
      expect(linkedin.disabled).toBe(true)
      expect(linkedin.tooltip).toMatch(/email/i)
    })

    it('disables Verify current email when Lead has no email', async () => {
      const wrapper = makeWrapper({ email: '' })
      await flushPromises()
      await nextTick()
      const verify = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Verify current email'),
      )
      expect(verify.disabled).toBe(true)
    })

    it('disables Find work email when Lead has no company website / org', async () => {
      const wrapper = makeWrapper({
        website: '',
        organization: '',
      })
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      expect(workEmail.disabled).toBe(true)
      expect(workEmail.tooltip).toMatch(/company/i)
    })
  })

  // ─── Click → call → toast ─────────────────────────────────────────
  describe('action invocation', () => {
    it('clicking an enabled action invokes call() with the right endpoint', async () => {
      callMock.mockResolvedValueOnce({
        ok: true,
        usage_log_name: 'BE-LOG-9',
      })
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      workEmail.onClick()
      await flushPromises()
      expect(callMock).toHaveBeenCalledTimes(1)
      const [endpoint, args] = callMock.mock.calls[0]
      expect(endpoint).toBe(
        'firmadapt_crm.integrations.betterenrich.api.find_work_email',
      )
      expect(args.lead_name).toBe('CRM-LEAD-2026-00001')
    })

    it('disabled action is a no-op (does not call backend)', async () => {
      state.quota.email = { scope: 'user_disabled', remaining: 0 }
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      workEmail.onClick()
      await flushPromises()
      expect(callMock).not.toHaveBeenCalled()
    })

    it('emits "enriched" after a successful action', async () => {
      callMock.mockResolvedValueOnce({
        ok: true,
        usage_log_name: 'BE-LOG-9',
      })
      const wrapper = makeWrapper()
      await flushPromises()
      await nextTick()
      const workEmail = wrapper.vm.actions.find((a) =>
        a.label.startsWith('Find work email'),
      )
      workEmail.onClick()
      await flushPromises()
      expect(wrapper.emitted('enriched')).toBeTruthy()
    })
  })
})
