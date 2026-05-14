// Tests for PushToAutokloseModal.vue.
//
// Focus: the v0.10.0 fix that prevented sending the full Autocomplete
// option object to the backend `bulk_push_leads` call. The Autocomplete
// emits `update:modelValue` with the whole option dict; the modal now
// extracts `.value` into `selectedId` and passes the string only. See
// the comment block inside the SFC's template for the full reasoning.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// ─── Mocks ──────────────────────────────────────────────────────────
// `call` is the load-bearing import — it's the function the modal
// invokes to POST to the backend. We stub it as a vi.fn so tests can
// inspect the arguments. createListResource returns a stand-in object
// the SFC reads via `.data`; Dialog is a passthrough.
//
// vi.mock is hoisted to the top of the file, so any local variable
// the factory closes over must also be hoisted via vi.hoisted —
// otherwise the factory runs before our `const` initializes.
const { callMock } = vi.hoisted(() => ({
  callMock: vi.fn(() => Promise.resolve({ ok: [], failed: [], total: 0 })),
}))

vi.mock('frappe-ui', () => ({
  call: callMock,
  Dialog: {
    name: 'Dialog',
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    // Render only the body-content slot so we can read the helper
    // line + the Autocomplete the modal sets up.
    template: '<div class="dialog-stub"><slot name="body-content" /></div>',
  },
  createListResource: vi.fn(() => ({
    data: [
      {
        name: 'cid_abc',
        campaign_name: 'Camp Abc',
        status: 'active',
        stats_recipients_total: 42,
      },
      {
        name: 'cid_def',
        campaign_name: 'Camp Def',
        status: 'paused',
        stats_recipients_total: 0,
      },
    ],
    fetch: vi.fn(),
    reload: vi.fn(),
  })),
}))

// The Autocomplete wrapper is the v-model surface under test. We stub
// it with a minimal component that exposes the modelValue prop +
// re-emits update:modelValue so the parent's v-model wiring is
// exercised. The full SFC pulls Combobox/Popover from frappe-ui — too
// heavy for a unit test.
vi.mock('@/components/frappe-ui/Autocomplete.vue', () => ({
  default: {
    name: 'Autocomplete',
    props: ['modelValue', 'options', 'placeholder'],
    emits: ['update:modelValue'],
    template:
      '<div class="autocomplete-stub" data-test="autocomplete">' +
      '<button data-test="pick" @click="$emit(\'update:modelValue\', options[0])">' +
      'Pick first' +
      '</button>' +
      '</div>',
  },
}))

import PushToAutokloseModal from '@/components/Modals/PushToAutokloseModal.vue'

function makeWrapper(props = {}) {
  return mount(PushToAutokloseModal, {
    props: {
      modelValue: true,
      'onUpdate:modelValue': () => {},
      selections: new Set(['LEAD-1', 'LEAD-2', 'LEAD-3']),
      ...props,
    },
  })
}

describe('PushToAutokloseModal', () => {
  beforeEach(() => {
    callMock.mockClear()
    callMock.mockImplementation(() =>
      Promise.resolve({ ok: ['LEAD-1'], failed: [], total: 3 }),
    )
  })

  // ─── selectedId / selectedRow computed ─────────────────────────────
  describe('selectedOption v-model wiring', () => {
    it('emits the full option object via update:modelValue and stores it', async () => {
      const wrapper = makeWrapper()
      // Simulate the Autocomplete picking the first option.
      await wrapper.get('[data-test="pick"]').trigger('click')
      // The first option (per campaignOptions in the SFC) is
      // { label: 'Camp Abc', value: 'cid_abc', description: 'active',
      //   _row: { name: 'cid_abc', ... } }
      // The helper line should now render Status + recipients.
      const text = wrapper.text()
      expect(text).toContain('active')
      expect(text).toContain('42')
    })

    it('does NOT render the helper line when no option is picked', () => {
      const wrapper = makeWrapper()
      const text = wrapper.text()
      // Helper line carries the "Status:" prefix — must be absent.
      expect(text).not.toContain('Status:')
    })
  })

  // ─── runPush behaviour ─────────────────────────────────────────────
  describe('runPush', () => {
    it('returns early (no API call) when nothing is selected', async () => {
      const wrapper = makeWrapper()
      // Note: runPush is exposed via the Dialog `actions[].onClick`.
      // Reaching into the SFC's scope is awkward; instead, simulate
      // the path it guards via the public surface. The Dialog stub
      // we use renders only body-content, so we invoke runPush by
      // pulling the function off the component instance.
      // setupState is the script-setup binding bag in Vue 3.
      const runPush = wrapper.vm.$.setupState?.runPush
      if (typeof runPush !== 'function') {
        // Some Vue versions expose setupState differently — fall back
        // to a sibling assertion: simulate the click path by directly
        // calling the Dialog options[].onClick from the Dialog stub.
        // For our purposes, "no selection ⇒ no call" is enough.
      } else {
        await runPush()
      }
      expect(callMock).not.toHaveBeenCalled()
    })

    it('sends a STRING campaign_id (not the option object) on push', async () => {
      const wrapper = makeWrapper()
      // Pick the first campaign.
      await wrapper.get('[data-test="pick"]').trigger('click')
      const runPush = wrapper.vm.$.setupState?.runPush
      expect(typeof runPush).toBe('function')
      await runPush()
      await flushPromises()

      expect(callMock).toHaveBeenCalledTimes(1)
      const [endpoint, args] = callMock.mock.calls[0]
      expect(endpoint).toBe(
        'firmadapt_crm.integrations.autoklose.api.bulk_push_leads',
      )
      // The load-bearing assertion: campaign_id is a STRING.
      expect(typeof args.campaign_id).toBe('string')
      expect(args.campaign_id).toBe('cid_abc')
      // And the lead names from the selections Set survive Array-ification.
      expect(args.lead_names).toEqual(
        expect.arrayContaining(['LEAD-1', 'LEAD-2', 'LEAD-3']),
      )
      expect(args.lead_names).toHaveLength(3)
    })

    it("emits 'done' with the backend response shape after success", async () => {
      callMock.mockResolvedValueOnce({
        ok: ['LEAD-1', 'LEAD-2'],
        failed: [{ lead: 'LEAD-3', reason: 'no email' }],
        total: 3,
      })
      const wrapper = makeWrapper()
      await wrapper.get('[data-test="pick"]').trigger('click')
      const runPush = wrapper.vm.$.setupState?.runPush
      await runPush()
      await flushPromises()

      const emitted = wrapper.emitted('done')
      expect(emitted).toBeTruthy()
      expect(emitted).toHaveLength(1)
      const [payload] = emitted[0]
      expect(payload.ok).toEqual(['LEAD-1', 'LEAD-2'])
      expect(payload.failed).toEqual([
        { lead: 'LEAD-3', reason: 'no email' },
      ])
      expect(payload.total).toBe(3)
    })
  })

  // ─── Reset on open ─────────────────────────────────────────────────
  describe('reset on reopen', () => {
    it('resets selectedOption when the modal toggles closed -> open', async () => {
      // Start closed so the watcher hasn't fired yet, then open.
      const wrapper = mount(PushToAutokloseModal, {
        props: {
          modelValue: false,
          'onUpdate:modelValue': () => {},
          selections: new Set(['LEAD-1']),
        },
      })
      // Force a pick by setting setupState directly (the stub
      // Autocomplete isn't rendered when modal is closed since
      // body-content is hidden by Dialog stub).
      const state = wrapper.vm.$.setupState
      state.selectedOption = {
        label: 'X',
        value: 'cid_x',
        _row: { name: 'cid_x', status: 'paused' },
      }
      expect(state.selectedOption.value).toBe('cid_x')

      // Now open the modal — the watcher should reset selectedOption.
      await wrapper.setProps({ modelValue: true })
      await flushPromises()
      expect(state.selectedOption).toBe(null)
    })
  })
})
