<template>
  <Dialog
    v-model="show"
    :options="{
      title: __('Import leads from CSV'),
      size: 'xl',
      actions: dialogActions,
    }"
  >
    <template #body-content>
      <div class="space-y-4">
        <!-- Step indicator. Three lightweight breadcrumb-style chips
             rather than a heavier Stepper component — the modal is
             linear and uses the Dialog action bar to advance, so the
             chips are purely informational. -->
        <div class="flex items-center gap-2 text-xs text-ink-gray-6">
          <span
            :class="
              currentStep === 'upload'
                ? 'font-semibold text-ink-gray-9'
                : 'text-ink-gray-5'
            "
          >
            {{ __('1. Upload') }}
          </span>
          <span class="text-ink-gray-4">›</span>
          <span
            :class="
              currentStep === 'preview'
                ? 'font-semibold text-ink-gray-9'
                : 'text-ink-gray-5'
            "
          >
            {{ __('2. Preview & map') }}
          </span>
          <span class="text-ink-gray-4">›</span>
          <span
            :class="
              currentStep === 'confirm'
                ? 'font-semibold text-ink-gray-9'
                : 'text-ink-gray-5'
            "
          >
            {{ __('3. Confirm') }}
          </span>
        </div>

        <!-- ── Step 1 — Upload ───────────────────────────────────── -->
        <div v-if="currentStep === 'upload'" class="space-y-3">
          <p class="text-sm text-ink-gray-7">
            {{
              __(
                'Pick a .csv or .xlsx file of leads. Frappe’s Data Import ' +
                  'engine auto-detects each column by header (label or ' +
                  'fieldname); you can override the mapping on the next ' +
                  'step. Rows that fail validation will be reported in ' +
                  'the Data Import doc after the background job finishes.',
              )
            }}
          </p>

          <label
            class="block w-full cursor-pointer rounded border border-dashed border-outline-gray-2 p-6 text-center hover:bg-surface-menu-bar"
            data-test="csv-file-picker"
          >
            <input
              ref="fileInputEl"
              type="file"
              :accept="ACCEPT_TYPES"
              class="hidden"
              data-test="csv-file-input"
              @change="onFilePicked"
            />
            <div v-if="!selectedFile" class="text-sm text-ink-gray-6">
              {{ __('Click to choose a .csv or .xlsx file') }}
            </div>
            <div v-else class="text-sm text-ink-gray-8">
              <div class="font-medium" data-test="csv-file-name">
                {{ selectedFile.name }}
              </div>
              <div class="text-xs text-ink-gray-5">
                {{ formatBytes(selectedFile.size) }}
              </div>
            </div>
          </label>

          <p
            v-if="errorMessage"
            class="rounded border border-outline-red-2 bg-surface-red-1 p-2 text-sm text-ink-red-7"
            data-test="csv-error"
          >
            {{ errorMessage }}
          </p>
        </div>

        <!-- ── Step 2 — Preview + mapping ────────────────────────── -->
        <div v-else-if="currentStep === 'preview'" class="space-y-3">
          <p class="text-sm text-ink-gray-7">
            {{
              __(
                'Auto-detected mapping shown for each column. Use the ' +
                  'dropdowns to override any column that mis-mapped, then ' +
                  'continue. Preview shows the first {0} rows of the file.',
                [previewRows.length],
              )
            }}
          </p>

          <div
            v-if="previewWarnings.length"
            class="rounded border border-outline-amber-2 bg-surface-amber-1 p-2 text-xs text-ink-amber-7"
            data-test="csv-warnings"
          >
            <div class="font-medium">{{ __('Warnings') }}</div>
            <ul class="ml-4 list-disc">
              <li v-for="(w, i) in previewWarnings" :key="i">
                {{ formatWarning(w) }}
              </li>
            </ul>
          </div>

          <div class="overflow-x-auto rounded border border-outline-gray-1">
            <table class="w-full text-xs" data-test="csv-preview-table">
              <thead class="bg-surface-menu-bar">
                <tr>
                  <th
                    v-for="(col, idx) in previewColumns"
                    :key="idx"
                    class="px-2 py-2 text-left font-medium text-ink-gray-8 border-r border-outline-gray-1 last:border-r-0 align-top"
                  >
                    <div class="mb-1 truncate" :title="col.header">
                      {{ col.header || __('(blank)') }}
                    </div>
                    <select
                      v-model="columnMapping[idx]"
                      class="w-full rounded border border-outline-gray-2 bg-surface-white px-1 py-0.5 text-xs"
                      :data-test="`csv-map-${idx}`"
                    >
                      <option value="">
                        {{ __('— Don’t import —') }}
                      </option>
                      <option
                        v-for="opt in mappingOptions"
                        :key="opt.value"
                        :value="opt.value"
                      >
                        {{ opt.label }}
                      </option>
                    </select>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, ri) in previewRows.slice(0, 5)"
                  :key="ri"
                  class="border-t border-outline-gray-1"
                >
                  <td
                    v-for="(cell, ci) in row"
                    :key="ci"
                    class="truncate px-2 py-1 text-ink-gray-7 border-r border-outline-gray-1 last:border-r-0 max-w-[200px]"
                    :title="String(cell ?? '')"
                  >
                    {{ cell }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p
            v-if="errorMessage"
            class="rounded border border-outline-red-2 bg-surface-red-1 p-2 text-sm text-ink-red-7"
            data-test="csv-error"
          >
            {{ errorMessage }}
          </p>
        </div>

        <!-- ── Step 3 — Confirm ──────────────────────────────────── -->
        <div v-else-if="currentStep === 'confirm'" class="space-y-3">
          <p
            class="rounded border border-outline-gray-1 bg-surface-menu-bar p-3 text-sm text-ink-gray-8"
            data-test="csv-confirm-summary"
          >
            {{
              __(
                'Will import {0} row(s) as new CRM Leads. The import ' +
                  'runs as a background job; you can watch progress on ' +
                  'the Data Import doc once it starts.',
                [totalRows],
              )
            }}
          </p>

          <div class="text-xs text-ink-gray-6">
            <div class="font-medium text-ink-gray-8 mb-1">
              {{ __('Mapping summary') }}
            </div>
            <ul class="ml-4 list-disc space-y-0.5">
              <li
                v-for="(col, idx) in previewColumns"
                :key="idx"
                :data-test="`csv-summary-${idx}`"
              >
                <span class="font-mono">{{ col.header || __('(blank)') }}</span>
                →
                <span v-if="columnMapping[idx]">{{ columnMapping[idx] }}</span>
                <span v-else class="text-ink-gray-5">
                  {{ __('(skipped)') }}
                </span>
              </li>
            </ul>
          </div>

          <p
            v-if="errorMessage"
            class="rounded border border-outline-red-2 bg-surface-red-1 p-2 text-sm text-ink-red-7"
            data-test="csv-error"
          >
            {{ errorMessage }}
          </p>
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
/**
 * v0.16.2 — CSV import for the Leads list page.
 *
 * Three-step flow:
 *   1. Upload  — admin picks a .csv or .xlsx file
 *   2. Preview — first 5 rows + auto-detected column→field mapping
 *   3. Confirm — "will import N rows" + start-import button
 *
 * Wire-level flow (matches the brief):
 *   a. POST /api/method/upload_file (multipart)         → {file_url}
 *   b. POST frappe.client.insert (Data Import)           → {name}
 *   c. POST frappe.client.set_value (attach file_url)
 *   d. POST data_import.get_preview_from_template        → preview + cols
 *   e. (optional) POST set_value on template_options if
 *      the admin overrides any column → field mappings
 *   f. POST data_import.start_import                     → enqueues job
 *
 * Why pipe through Frappe Data Import:
 *   The engine already handles per-row error reporting, idempotent
 *   re-imports, queueing, and is aware of every custom field we add
 *   to CRM Lead (v0.1/v0.2 fields). Reimplementing it would duplicate
 *   a lot of well-tested infra. This SFC is a UX wrapper so admins can
 *   reach the import without leaving the SPA — the Data Import doc
 *   page (/app/data-import/{name}) is still the source of truth for
 *   progress + per-row errors and we surface a link to it on success.
 *
 * SPA conventions honored:
 *   • Dialog actions array with explicit Cancel (Module 2/3/3b/3c)
 *   • Button theme limited to gray|blue|green|red
 *   • toast.create({message, type}) — not {title, text}
 *   • State reset on each open via watch(show)
 *   • FormControl / plain inputs (no Autocomplete here — the per-
 *     column mapping uses native <select> for performance: a CSV
 *     with 30 columns × Autocomplete instances paints noticeably)
 */
import { Dialog, call, toast } from 'frappe-ui'
import { computed, ref, watch } from 'vue'

const emit = defineEmits(['done'])
const show = defineModel({ type: Boolean })

// ─── File-picker constants ─────────────────────────────────────────
// Brief calls for .csv + .xlsx. .xlsm is allowed too — same engine
// handles it, and admins occasionally hand us macro-enabled exports
// from Excel. accept= attr is a hint only; the real check is the
// file extension we run client-side before upload.
const ACCEPT_TYPES =
  '.csv,.xlsx,.xlsm,text/csv,' +
  'application/vnd.ms-excel,' +
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const ALLOWED_EXT = ['.csv', '.xlsx', '.xlsm']

// ─── Reactive state ────────────────────────────────────────────────
const currentStep = ref('upload') // 'upload' | 'preview' | 'confirm'
const selectedFile = ref(null)
const fileInputEl = ref(null)

// Backend handles.
const uploadedFileUrl = ref('')
const dataImportName = ref('')

// Preview state from get_preview_from_template.
const previewColumns = ref([]) // [{header, fieldname?}]
const previewRows = ref([]) // [[cell, cell, …], …]
const previewWarnings = ref([])
const totalRows = ref(0) // populated after preview parses the file

// columnMapping[idx] is the chosen CRM Lead fieldname for column `idx`
// (empty string means "don't import"). Initialised from the auto-
// detected `fieldname` on each column.
const columnMapping = ref([])

// Static field list for the dropdowns. Built once when preview lands
// from the column metadata Frappe returns. We rebuild the union of
// "all fields seen across columns + standard fields" so admins can
// remap to any field the engine knows about — not just the one Frappe
// happened to auto-detect for that column.
const knownFields = ref([])

const errorMessage = ref('')
const uploading = ref(false)
const loadingPreview = ref(false)
const startingImport = ref(false)

// ─── Dialog actions (reactive — drives the step buttons) ──────────
// frappe-ui Dialog renders the `actions` array as a row of buttons in
// the dialog footer. We rebuild it per step so the primary action's
// label / handler match the step. Always include Cancel.
const dialogActions = computed(() => {
  if (currentStep.value === 'upload') {
    return [
      {
        label: __('Upload & preview'),
        variant: 'solid',
        theme: 'blue',
        loading: uploading.value || loadingPreview.value,
        onClick: runUploadAndPreview,
      },
      { label: __('Cancel') },
    ]
  }
  if (currentStep.value === 'preview') {
    return [
      {
        label: __('Continue'),
        variant: 'solid',
        theme: 'blue',
        onClick: goToConfirm,
      },
      {
        label: __('Back'),
        onClick: () => (currentStep.value = 'upload'),
      },
      { label: __('Cancel') },
    ]
  }
  // confirm
  return [
    {
      label: __('Start import'),
      variant: 'solid',
      theme: 'green',
      loading: startingImport.value,
      onClick: runStartImport,
    },
    {
      label: __('Back'),
      onClick: () => (currentStep.value = 'preview'),
    },
    { label: __('Cancel') },
  ]
})

// ─── Reset on each open ────────────────────────────────────────────
// Honors the SPA convention. Without this, a Cancel-then-reopen
// shows the previous file + preview, which confuses admins.
watch(show, (open) => {
  if (open) resetState()
})

function resetState() {
  currentStep.value = 'upload'
  selectedFile.value = null
  uploadedFileUrl.value = ''
  dataImportName.value = ''
  previewColumns.value = []
  previewRows.value = []
  previewWarnings.value = []
  totalRows.value = 0
  columnMapping.value = []
  knownFields.value = []
  errorMessage.value = ''
  uploading.value = false
  loadingPreview.value = false
  startingImport.value = false
  if (fileInputEl.value) fileInputEl.value.value = ''
}

// ─── Helpers ───────────────────────────────────────────────────────
function hasAllowedExt(name) {
  const lower = (name || '').toLowerCase()
  return ALLOWED_EXT.some((ext) => lower.endsWith(ext))
}

function formatBytes(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatWarning(w) {
  if (typeof w === 'string') return w
  if (w?.message) return w.message
  try {
    return JSON.stringify(w)
  } catch {
    return String(w)
  }
}

function onFilePicked(ev) {
  errorMessage.value = ''
  const f = ev?.target?.files?.[0]
  if (!f) {
    selectedFile.value = null
    return
  }
  if (!hasAllowedExt(f.name)) {
    errorMessage.value = __('Only .csv, .xlsx, .xlsm files are accepted.')
    selectedFile.value = null
    if (fileInputEl.value) fileInputEl.value.value = ''
    return
  }
  selectedFile.value = f
}

// ─── Step 1 → 2: upload file, create Data Import doc, fetch preview
async function runUploadAndPreview(close) {
  errorMessage.value = ''
  if (!selectedFile.value) {
    errorMessage.value = __('Please choose a file first.')
    return
  }

  uploading.value = true
  try {
    // (a) Multipart upload via Frappe's standard endpoint. We use
    //     fetch directly here rather than the XMLHttpRequest-based
    //     handler in FilesUploader/filesUploaderHandler.ts because we
    //     don't need progress events for a single-file admin import,
    //     and fetch keeps the dependency surface smaller.
    const fd = new FormData()
    fd.append('file', selectedFile.value, selectedFile.value.name)
    fd.append('is_private', '1')
    fd.append('folder', 'Home')

    const headers = { Accept: 'application/json' }
    if (window.csrf_token && window.csrf_token !== '{{ csrf_token }}') {
      headers['X-Frappe-CSRF-Token'] = window.csrf_token
    }

    const uploadResp = await fetch('/api/method/upload_file', {
      method: 'POST',
      headers,
      body: fd,
    })
    if (!uploadResp.ok) {
      throw new Error(__('Upload failed (HTTP {0}).', [uploadResp.status]))
    }
    const uploadJson = await uploadResp.json()
    const fileUrl =
      uploadJson?.message?.file_url || uploadJson?.file_url || ''
    if (!fileUrl) throw new Error(__('Upload did not return a file URL.'))
    uploadedFileUrl.value = fileUrl
    uploading.value = false

    loadingPreview.value = true

    // (b) Create the Data Import doc (without file yet). We could
    //     attach the file in one call via insert's `doc.import_file`
    //     field, but the brief asks for the explicit two-step flow
    //     (insert then set_value), which mirrors the way Frappe's own
    //     Desk page does it.
    const insertResp = await call('frappe.client.insert', {
      doc: {
        doctype: 'Data Import',
        reference_doctype: 'CRM Lead',
        import_type: 'Insert New Records',
        mute_emails: 1,
        submit_after_import: 0,
      },
    })
    const diName = insertResp?.name
    if (!diName) throw new Error(__('Could not create Data Import doc.'))
    dataImportName.value = diName

    // (c) Attach the uploaded file URL onto Data Import.import_file.
    await call('frappe.client.set_value', {
      doctype: 'Data Import',
      name: diName,
      fieldname: 'import_file',
      value: fileUrl,
    })

    // (d) Pull preview + auto-detected mapping.
    const preview = await call(
      'frappe.core.doctype.data_import.data_import.get_preview_from_template',
      {
        data_import: diName,
        import_file: fileUrl,
        google_sheets_url: null,
      },
    )

    // Normalise the column + row shapes. Frappe returns columns as
    // a list of objects with `header_title` (CSV header text) and
    // `map_to_field` (the auto-detected fieldname), but older /
    // alternate versions return slight variants — be defensive.
    const rawColumns = preview?.columns || []
    previewColumns.value = rawColumns.map((c) => ({
      header: c?.header_title ?? c?.label ?? c?.header ?? '',
      fieldname: c?.map_to_field ?? c?.fieldname ?? '',
    }))
    const rawData = preview?.data || []
    // First row of `data` is typically the header echo — skip it
    // when it matches our column headers, otherwise treat all rows
    // as data.
    let dataRows = rawData
    if (
      dataRows.length &&
      Array.isArray(dataRows[0]) &&
      dataRows[0].length === previewColumns.value.length &&
      dataRows[0].every(
        (cell, i) => String(cell) === String(previewColumns.value[i].header),
      )
    ) {
      dataRows = dataRows.slice(1)
    }
    previewRows.value = dataRows
    previewWarnings.value = preview?.warnings || []
    totalRows.value = dataRows.length

    // Seed columnMapping from the auto-detected fieldnames and
    // collect the union of known fields for the dropdowns.
    columnMapping.value = previewColumns.value.map((c) => c.fieldname || '')

    const fieldSet = new Map()
    previewColumns.value.forEach((c) => {
      if (c.fieldname && !fieldSet.has(c.fieldname)) {
        fieldSet.set(c.fieldname, c.fieldname)
      }
    })
    // Plus a small set of common CRM Lead fields admins typically
    // want to map. Engine validates this list server-side; we just
    // need to surface something reasonable when auto-detect missed.
    const STANDARD_CRM_LEAD_FIELDS = [
      'first_name',
      'last_name',
      'lead_name',
      'email',
      'mobile_no',
      'phone',
      'organization',
      'website',
      'status',
      'industry',
      'territory',
      'job_title',
      'no_of_employees',
      'annual_revenue',
      'source',
      'lead_owner',
    ]
    STANDARD_CRM_LEAD_FIELDS.forEach((f) => {
      if (!fieldSet.has(f)) fieldSet.set(f, f)
    })
    knownFields.value = Array.from(fieldSet.keys())

    currentStep.value = 'preview'
  } catch (e) {
    errorMessage.value =
      e?.messages?.join(', ') || e?.message || __('Failed to upload file.')
  } finally {
    uploading.value = false
    loadingPreview.value = false
  }
}

const mappingOptions = computed(() => {
  return knownFields.value.map((f) => ({ label: f, value: f }))
})

// ─── Step 2 → 3: persist any mapping overrides, then advance ──────
async function goToConfirm() {
  errorMessage.value = ''
  // If the user overrode any column-to-field mapping, persist it on
  // Data Import.template_options as JSON. Frappe reads this when the
  // background job runs. The shape mirrors what the Desk UI writes —
  // `column_to_field_map` keyed by column header.
  const overrides = {}
  previewColumns.value.forEach((c, i) => {
    overrides[c.header] = columnMapping.value[i] || ''
  })
  try {
    await call('frappe.client.set_value', {
      doctype: 'Data Import',
      name: dataImportName.value,
      fieldname: 'template_options',
      value: JSON.stringify({ column_to_field_map: overrides }),
    })
    currentStep.value = 'confirm'
  } catch (e) {
    errorMessage.value =
      e?.messages?.join(', ') ||
      e?.message ||
      __('Could not save column mapping.')
  }
}

// ─── Step 3 → kick off the import ─────────────────────────────────
async function runStartImport(close) {
  errorMessage.value = ''
  if (!dataImportName.value) {
    errorMessage.value = __('No Data Import doc to start.')
    return
  }
  startingImport.value = true
  try {
    await call(
      'frappe.core.doctype.data_import.data_import.start_import',
      { data_import: dataImportName.value },
    )
    toast.create({
      message: __('Import started — {0} row(s) queued.', [totalRows.value]),
      type: 'success',
    })
    emit('done', {
      data_import: dataImportName.value,
      total_rows: totalRows.value,
      desk_url: `/app/data-import/${encodeURIComponent(dataImportName.value)}`,
    })
    close?.()
  } catch (e) {
    errorMessage.value =
      e?.messages?.join(', ') || e?.message || __('Failed to start import.')
  } finally {
    startingImport.value = false
  }
}

// Exposed for tests — Vue 3 script-setup keeps bindings local by
// default, but the unit test asserts the wiring through the
// component's setupState bag (see PushToAutokloseModal.test.js for
// precedent).
defineExpose({
  currentStep,
  selectedFile,
  uploadedFileUrl,
  dataImportName,
  previewColumns,
  previewRows,
  columnMapping,
  totalRows,
  runUploadAndPreview,
  goToConfirm,
  runStartImport,
  onFilePicked,
  resetState,
})
</script>
