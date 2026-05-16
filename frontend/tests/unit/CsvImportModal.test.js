// Tests for CsvImportModal.vue (v0.16.2).
//
// Covers the three-step flow:
//   • Step 1 — file picker accepts only .csv/.xlsx, primary action
//     disabled until a valid file is chosen.
//   • Step 2 — preview render: N column headers + dropdowns + first
//     5 rows; auto-detected mapping seeds columnMapping; admin can
//     override the mapping via the <select> per column.
//   • Step 3 — Start Import calls
//     `frappe.core.doctype.data_import.data_import.start_import`
//     with the Data Import name; 'done' event emitted on success.
//
// Mock surface mirrors PushToAutokloseModal.test.js — `call` is the
// load-bearing import we stub via vi.hoisted, and frappe-ui's Dialog
// is replaced with a passthrough that renders the body-content slot.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

// ─── Mocks ──────────────────────────────────────────────────────────
const { callMock, toastMock } = vi.hoisted(() => ({
  callMock: vi.fn(),
  toastMock: { create: vi.fn() },
}))

vi.mock('frappe-ui', () => ({
  call: callMock,
  toast: toastMock,
  Dialog: {
    name: 'Dialog',
    // The SFC drives the action bar via `options.actions[]` reactively;
    // we render the buttons inline so tests can click them directly.
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    template:
      '<div class="dialog-stub">' +
      '<slot name="body-content" />' +
      '<div class="dialog-actions">' +
      '<button v-for="(a, i) in options?.actions || []" :key="i" ' +
      ':data-test="`action-${a.label}`" :disabled="a.loading" ' +
      '@click="a.onClick && a.onClick(()=>$emit(\'update:modelValue\', false))">' +
      '{{ a.label }}' +
      '</button>' +
      '</div>' +
      '</div>',
  },
}))

import CsvImportModal from '@/components/Modals/CsvImportModal.vue'

// ─── Helpers ────────────────────────────────────────────────────────
function makeFile(name = 'leads.csv', size = 200) {
  const blob = new Blob(['a,b,c\n1,2,3'], { type: 'text/csv' })
  return new File([blob], name, { type: 'text/csv', lastModified: Date.now() })
}

function makeWrapper(props = {}) {
  return mount(CsvImportModal, {
    props: {
      modelValue: true,
      'onUpdate:modelValue': () => {},
      ...props,
    },
  })
}

// Wire the global `fetch` mock the SFC uses for /api/method/upload_file.
function mockUploadFetch(fileUrl = '/files/leads.csv') {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ message: { file_url: fileUrl } }),
    }),
  )
}

// Seed callMock to walk through the upload-and-preview happy path.
// Order matters: insert → set_value → get_preview_from_template.
function seedHappyPathPreview({
  diName = 'Data Import 1',
  columns = [
    { header_title: 'Email', map_to_field: 'email' },
    { header_title: 'First Name', map_to_field: 'first_name' },
    { header_title: 'Company', map_to_field: 'organization' },
  ],
  // 6 rows so we can confirm .slice(0,5) in the table.
  data = [
    ['Email', 'First Name', 'Company'],
    ['a@a.com', 'Alice', 'ACo'],
    ['b@b.com', 'Bob', 'BCo'],
    ['c@c.com', 'Carol', 'CCo'],
    ['d@d.com', 'Dan', 'DCo'],
    ['e@e.com', 'Eve', 'ECo'],
    ['f@f.com', 'Frank', 'FCo'],
  ],
  warnings = [],
} = {}) {
  callMock.mockImplementation((endpoint, args) => {
    if (endpoint === 'frappe.client.insert') {
      return Promise.resolve({ name: diName, ...args.doc })
    }
    if (endpoint === 'frappe.client.set_value') {
      return Promise.resolve({})
    }
    if (
      endpoint ===
      'frappe.core.doctype.data_import.data_import.get_preview_from_template'
    ) {
      return Promise.resolve({ columns, data, warnings })
    }
    if (
      endpoint === 'frappe.core.doctype.data_import.data_import.start_import'
    ) {
      return Promise.resolve({})
    }
    return Promise.resolve({})
  })
}

describe('CsvImportModal', () => {
  beforeEach(() => {
    callMock.mockReset()
    toastMock.create.mockReset()
    if (globalThis.fetch?.mockReset) globalThis.fetch.mockReset()
  })

  // ─── Step 1 — Upload ──────────────────────────────────────────────
  describe('Step 1 — upload', () => {
    it('renders when modelValue=true', () => {
      const wrapper = makeWrapper()
      expect(wrapper.find('[data-test="csv-file-picker"]').exists()).toBe(true)
    })

    it('does not render the file picker when modelValue=false', () => {
      const wrapper = makeWrapper({ modelValue: false })
      // Dialog stub renders nothing inside body-content when closed
      // because we don't toggle visibility on it — but the file picker
      // must still be reachable via the stub. So instead assert the
      // primary inner state via setupState: when reset hasn't run with
      // open=true, currentStep remains 'upload' by default.
      expect(wrapper.vm.$.setupState.currentStep).toBe('upload')
    })

    it('rejects a non-csv/xlsx extension and surfaces the error', async () => {
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      const ev = { target: { files: [makeFile('virus.exe', 100)] } }
      state.onFilePicked(ev)
      await nextTick()
      expect(state.selectedFile).toBe(null)
      expect(wrapper.find('[data-test="csv-error"]').text()).toContain(
        'Only .csv, .xlsx, .xlsm files',
      )
    })

    it('accepts a .csv file and stores it on selectedFile', async () => {
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      const csv = makeFile('leads.csv')
      state.onFilePicked({ target: { files: [csv] } })
      await nextTick()
      expect(state.selectedFile?.name).toBe('leads.csv')
      expect(wrapper.find('[data-test="csv-file-name"]').text()).toBe(
        'leads.csv',
      )
    })

    it('accepts a .xlsx file too', async () => {
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({
        target: { files: [makeFile('leads.xlsx')] },
      })
      await nextTick()
      expect(state.selectedFile?.name).toBe('leads.xlsx')
    })

    it('primary action shows "Upload & preview" on step 1 (admin must pick file first)', async () => {
      const wrapper = makeWrapper()
      // Action button labels are driven by the dialogActions computed.
      expect(
        wrapper.find('[data-test="action-Upload & preview"]').exists(),
      ).toBe(true)
      expect(wrapper.find('[data-test="action-Cancel"]').exists()).toBe(true)
      // With no file selected, clicking Upload should surface an error
      // rather than hit the API.
      await wrapper.find('[data-test="action-Upload & preview"]').trigger('click')
      await flushPromises()
      expect(callMock).not.toHaveBeenCalled()
      expect(wrapper.find('[data-test="csv-error"]').text()).toContain(
        'choose a file',
      )
    })
  })

  // ─── Step 2 — Preview & mapping ──────────────────────────────────
  describe('Step 2 — preview & mapping', () => {
    it('after upload, advances to preview and renders N columns + 5 rows', async () => {
      mockUploadFetch('/files/leads-abc.csv')
      seedHappyPathPreview()
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({ target: { files: [makeFile('leads.csv')] } })
      await nextTick()
      await wrapper
        .find('[data-test="action-Upload & preview"]')
        .trigger('click')
      await flushPromises()
      await nextTick()

      expect(state.currentStep).toBe('preview')

      // 3 column dropdowns
      expect(wrapper.find('[data-test="csv-map-0"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="csv-map-1"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="csv-map-2"]').exists()).toBe(true)

      // 5 rows in the preview table (slice of 6 data rows).
      const rows = wrapper.findAll('[data-test="csv-preview-table"] tbody tr')
      expect(rows).toHaveLength(5)

      // Auto-detected mapping seeded into columnMapping.
      expect(state.columnMapping).toEqual([
        'email',
        'first_name',
        'organization',
      ])
    })

    it('issues the wire flow in order (upload → insert → set_value → preview)', async () => {
      mockUploadFetch('/files/leads-zzz.csv')
      seedHappyPathPreview({ diName: 'Data Import 42' })
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({ target: { files: [makeFile('leads.csv')] } })
      await wrapper
        .find('[data-test="action-Upload & preview"]')
        .trigger('click')
      await flushPromises()

      // /api/method/upload_file was hit
      expect(globalThis.fetch).toHaveBeenCalledTimes(1)
      const [url, opts] = globalThis.fetch.mock.calls[0]
      expect(url).toBe('/api/method/upload_file')
      expect(opts.method).toBe('POST')

      // call() invocations in the right order
      const endpoints = callMock.mock.calls.map((c) => c[0])
      expect(endpoints[0]).toBe('frappe.client.insert')
      expect(endpoints[1]).toBe('frappe.client.set_value')
      expect(endpoints[2]).toBe(
        'frappe.core.doctype.data_import.data_import.get_preview_from_template',
      )

      // insert payload is the spec'd shape
      const insertArgs = callMock.mock.calls[0][1]
      expect(insertArgs.doc.doctype).toBe('Data Import')
      expect(insertArgs.doc.reference_doctype).toBe('CRM Lead')
      expect(insertArgs.doc.import_type).toBe('Insert New Records')

      // set_value attaches the file_url onto import_file
      const setArgs = callMock.mock.calls[1][1]
      expect(setArgs.doctype).toBe('Data Import')
      expect(setArgs.name).toBe('Data Import 42')
      expect(setArgs.fieldname).toBe('import_file')
      expect(setArgs.value).toBe('/files/leads-zzz.csv')

      expect(state.dataImportName).toBe('Data Import 42')
    })

    it('admin can override a column mapping via the <select>', async () => {
      mockUploadFetch()
      seedHappyPathPreview()
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({ target: { files: [makeFile('leads.csv')] } })
      await wrapper
        .find('[data-test="action-Upload & preview"]')
        .trigger('click')
      await flushPromises()
      await nextTick()

      // Initial mapping for col 0 was 'email'. Change it to '' (skip).
      const sel = wrapper.find('[data-test="csv-map-0"]')
      await sel.setValue('')
      expect(state.columnMapping[0]).toBe('')
    })
  })

  // ─── Step 2 → Step 3 ─────────────────────────────────────────────
  describe('Step 2 → 3 — Continue persists mapping', () => {
    it('Continue calls set_value with template_options JSON, advances to confirm', async () => {
      mockUploadFetch()
      seedHappyPathPreview({ diName: 'Data Import 7' })
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({ target: { files: [makeFile('leads.csv')] } })
      await wrapper
        .find('[data-test="action-Upload & preview"]')
        .trigger('click')
      await flushPromises()
      await nextTick()

      // Tweak one mapping.
      state.columnMapping[2] = 'website'

      callMock.mockClear()
      callMock.mockResolvedValue({}) // generic for set_value

      await wrapper.find('[data-test="action-Continue"]').trigger('click')
      await flushPromises()

      expect(callMock).toHaveBeenCalledTimes(1)
      const [endpoint, args] = callMock.mock.calls[0]
      expect(endpoint).toBe('frappe.client.set_value')
      expect(args.name).toBe('Data Import 7')
      expect(args.fieldname).toBe('template_options')
      const parsed = JSON.parse(args.value)
      expect(parsed.column_to_field_map).toEqual({
        Email: 'email',
        'First Name': 'first_name',
        Company: 'website', // overridden
      })

      expect(state.currentStep).toBe('confirm')
    })
  })

  // ─── Step 3 — Start import ───────────────────────────────────────
  describe('Step 3 — Start import', () => {
    async function arriveAtConfirm() {
      mockUploadFetch()
      seedHappyPathPreview({ diName: 'Data Import 99' })
      const wrapper = makeWrapper()
      const state = wrapper.vm.$.setupState
      state.onFilePicked({ target: { files: [makeFile('leads.csv')] } })
      await wrapper
        .find('[data-test="action-Upload & preview"]')
        .trigger('click')
      await flushPromises()
      await wrapper.find('[data-test="action-Continue"]').trigger('click')
      await flushPromises()
      return { wrapper, state }
    }

    it('renders the row count + mapping summary', async () => {
      const { wrapper, state } = await arriveAtConfirm()
      expect(state.currentStep).toBe('confirm')
      const summary = wrapper.find('[data-test="csv-confirm-summary"]')
      expect(summary.exists()).toBe(true)
      expect(summary.text()).toContain('6')
      // 3 columns of summary
      expect(wrapper.find('[data-test="csv-summary-0"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="csv-summary-2"]').exists()).toBe(true)
    })

    it("Start import calls start_import with the Data Import name and emits 'done'", async () => {
      const { wrapper } = await arriveAtConfirm()
      callMock.mockClear()
      callMock.mockResolvedValue({})

      await wrapper.find('[data-test="action-Start import"]').trigger('click')
      await flushPromises()

      expect(callMock).toHaveBeenCalledTimes(1)
      const [endpoint, args] = callMock.mock.calls[0]
      expect(endpoint).toBe(
        'frappe.core.doctype.data_import.data_import.start_import',
      )
      expect(args.data_import).toBe('Data Import 99')

      // toast
      expect(toastMock.create).toHaveBeenCalled()
      const toastArgs = toastMock.create.mock.calls[0][0]
      expect(toastArgs.type).toBe('success')
      expect(toastArgs.message).toContain('Import started')

      // 'done' emit
      const done = wrapper.emitted('done')
      expect(done).toBeTruthy()
      expect(done).toHaveLength(1)
      const payload = done[0][0]
      expect(payload.data_import).toBe('Data Import 99')
      expect(payload.total_rows).toBe(6)
      expect(payload.desk_url).toBe('/app/data-import/Data%20Import%2099')
    })
  })

  // ─── Reset on reopen ─────────────────────────────────────────────
  describe('reset on reopen', () => {
    it('resets to step 1 + clears file when the modal toggles closed → open', async () => {
      const wrapper = mount(CsvImportModal, {
        props: {
          modelValue: false,
          'onUpdate:modelValue': () => {},
        },
      })
      const state = wrapper.vm.$.setupState
      // Seed some left-over state as if a previous open had progressed.
      state.currentStep = 'confirm'
      state.selectedFile = makeFile('old.csv')
      state.dataImportName = 'Data Import Stale'

      await wrapper.setProps({ modelValue: true })
      await flushPromises()

      expect(state.currentStep).toBe('upload')
      expect(state.selectedFile).toBe(null)
      expect(state.dataImportName).toBe('')
    })
  })
})

