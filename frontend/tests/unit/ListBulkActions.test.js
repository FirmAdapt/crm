// Focused tests for the v0.10.0 Autoklose branches of bulkActions()
// in ListBulkActions.vue. We don't exercise the whole component — only
// the bulkActions(selections, unselectAll) factory exposed via
// defineExpose. The test mounts the component with stubbed deps and
// reads the factory off the wrapper.vm.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// ─── Mocks ──────────────────────────────────────────────────────────
// frappe-ui exposes call/toast — both are read at script-setup time, so
// they need to exist on the mock module. We never actually trigger any
// onClick here, but the imports must resolve.
vi.mock('frappe-ui', () => ({
  call: vi.fn(() => Promise.resolve({})),
  toast: {
    create: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('frappe-ui/frappe', () => ({
  useTelemetry: () => ({ capture: vi.fn() }),
}))

// vue-router's useRouter() is called at setup time.
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// Module-local utils — setupListCustomizations runs in onMounted and
// awaits an async, so we resolve to an empty object to keep the path
// quiet.
vi.mock('@/utils', () => ({
  setupListCustomizations: vi.fn(() => Promise.resolve({})),
}))

// Modal children — stub to empty so we don't need their deps.
vi.mock('@/components/Modals/EditValueModal.vue', () => ({
  default: { name: 'EditValueModal', render: () => null },
}))
vi.mock('@/components/Modals/AssignmentModal.vue', () => ({
  default: { name: 'AssignmentModal', render: () => null },
}))
vi.mock('@/components/Modals/PushToAutokloseModal.vue', () => ({
  default: { name: 'PushToAutokloseModal', render: () => null },
}))
vi.mock('@/components/Modals/DeleteLinkedDocModal.vue', () => ({
  default: { name: 'DeleteLinkedDocModal', render: () => null },
}))
vi.mock('@/components/Modals/BulkDeleteLinkedDocModal.vue', () => ({
  default: { name: 'BulkDeleteLinkedDocModal', render: () => null },
}))

import ListBulkActions from '@/components/ListBulkActions.vue'

function makeWrapper({ doctype = '', options = {} } = {}) {
  setActivePinia(createPinia())
  return mount(ListBulkActions, {
    props: {
      doctype,
      options,
      // v-model:list — provide a stand-in list resource with reload().
      modelValue: { reload: vi.fn(), data: [] },
      'onUpdate:modelValue': () => {},
    },
    global: {
      plugins: [createPinia()],
      // Silence the unresolved-component warnings emitted by the
      // template — these modals are mounted off-screen and are out of
      // scope for the bulkActions() factory we're testing.
      stubs: {
        EditValueModal: true,
        AssignmentModal: true,
        PushToAutokloseModal: true,
        DeleteLinkedDocModal: true,
        BulkDeleteLinkedDocModal: true,
      },
    },
  })
}

function labels(actions) {
  return actions.map((a) => a.label)
}

describe('ListBulkActions.bulkActions — Autoklose branches', () => {
  let selections, unselectAll

  beforeEach(() => {
    selections = new Set(['LEAD-001', 'LEAD-002'])
    unselectAll = vi.fn()
  })

  // ─── Autoklose Campaign branch ────────────────────────────────────
  describe('doctype = "Autoklose Campaign" (admin bulk-actions surface)', () => {
    it('exposes Pause selected + Resume selected', () => {
      const wrapper = makeWrapper({
        doctype: 'Autoklose Campaign',
        // CampaignsListView passes hideEdit/hideAssign/hideDelete so the
        // edit/delete/assign actions don't appear in this dropdown.
        options: { hideEdit: true, hideAssign: true, hideDelete: true },
      })
      const actions = wrapper.vm.bulkActions(selections, unselectAll)
      const lbls = labels(actions)
      expect(lbls).toContain('Pause selected')
      expect(lbls).toContain('Resume selected')
    })

    it('hides Edit / Delete / Assign To when those options are set', () => {
      const wrapper = makeWrapper({
        doctype: 'Autoklose Campaign',
        options: { hideEdit: true, hideAssign: true, hideDelete: true },
      })
      const lbls = labels(wrapper.vm.bulkActions(selections, unselectAll))
      expect(lbls).not.toContain('Edit')
      expect(lbls).not.toContain('Delete')
      expect(lbls).not.toContain('Assign To')
      expect(lbls).not.toContain('Clear Assignment')
    })

    it('Pause/Resume entries are functions with onClick', () => {
      const wrapper = makeWrapper({
        doctype: 'Autoklose Campaign',
        options: { hideEdit: true, hideAssign: true, hideDelete: true },
      })
      const actions = wrapper.vm.bulkActions(selections, unselectAll)
      const pause = actions.find((a) => a.label === 'Pause selected')
      const resume = actions.find((a) => a.label === 'Resume selected')
      expect(typeof pause.onClick).toBe('function')
      expect(typeof resume.onClick).toBe('function')
    })
  })

  // ─── CRM Lead branch ──────────────────────────────────────────────
  describe('doctype = "CRM Lead"', () => {
    it('contains Push to Autoklose alongside the standard lead actions', () => {
      const wrapper = makeWrapper({ doctype: 'CRM Lead' })
      const lbls = labels(wrapper.vm.bulkActions(selections, unselectAll))
      // v0.10.0 addition
      expect(lbls).toContain('Push to Autoklose')
      // Established lead-list actions still present
      expect(lbls).toContain('Convert to Deal')
      expect(lbls).toContain('Edit')
      expect(lbls).toContain('Delete')
      expect(lbls).toContain('Assign To')
      expect(lbls).toContain('Clear Assignment')
    })

    it('does NOT include Pause / Resume on the Lead surface', () => {
      const wrapper = makeWrapper({ doctype: 'CRM Lead' })
      const lbls = labels(wrapper.vm.bulkActions(selections, unselectAll))
      expect(lbls).not.toContain('Pause selected')
      expect(lbls).not.toContain('Resume selected')
    })
  })

  // ─── Other doctypes (e.g. CRM Deal) ───────────────────────────────
  describe('doctype = "CRM Deal" (a non-Autoklose surface)', () => {
    it('shows neither the Lead nor the Campaign Autoklose branch', () => {
      const wrapper = makeWrapper({ doctype: 'CRM Deal' })
      const lbls = labels(wrapper.vm.bulkActions(selections, unselectAll))
      expect(lbls).not.toContain('Push to Autoklose')
      expect(lbls).not.toContain('Convert to Deal')
      expect(lbls).not.toContain('Pause selected')
      expect(lbls).not.toContain('Resume selected')
      // Default options keep Edit/Delete/Assign To/Clear Assignment.
      expect(lbls).toContain('Edit')
      expect(lbls).toContain('Delete')
    })
  })
})
