<template>
  <div>
    <slot name="header" v-bind="{ opened, hide, open, close, toggle }">
      <div
        v-if="!hide"
        class="section-header flex items-center justify-between"
        :class="headerClass"
      >
        <div
          class="flex text-ink-gray-9 max-w-fit cursor-pointer items-center gap-2 text-base"
          :class="labelClass"
          @click="collapsible && toggle()"
        >
          <FeatherIcon
            v-if="collapsible && collapseIconPosition === 'left'"
            name="chevron-right"
            class="h-4 transition-all duration-300 ease-in-out"
            :class="{ 'rotate-90': opened }"
          />
          <span>
            {{ __(label) || __('Untitled') }}
          </span>
          <FeatherIcon
            v-if="collapsible && collapseIconPosition === 'right'"
            name="chevron-right"
            class="h-4 transition-all duration-300 ease-in-out"
            :class="{ 'rotate-90': opened }"
          />
        </div>
        <slot name="actions"></slot>
      </div>
    </slot>
    <!-- v0.16.9 (firmadapt) — dropped the `<transition>` wrapper that
         animated `max-h-[200px]` between 0/200. It worked fine for
         individual chevron clicks on small sections but locked
         taller sections at 200px and prevented `v-show`'s
         `display:none` from applying when 36 sections leave at once
         (Expand/Collapse all). Plain v-show toggles instantly —
         acceptable UX for a bulk affordance. -->
    <div v-show="opened" class="columns" v-bind="$attrs">
      <slot v-bind="{ opened, open, close, toggle }" />
    </div>
  </div>
</template>
<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  label: { type: String, default: '' },
  hideLabel: { type: Boolean, default: false },
  opened: { type: Boolean, default: true },
  collapsible: { type: Boolean, default: true },
  collapseIconPosition: { type: String, default: 'left' },
  labelClass: { type: [String, Object, Array], default: '' },
  headerClass: { type: [String, Object, Array], default: '' },
})

const hide = ref(props.hideLabel)
const opened = ref(props.opened)

function toggle() {
  opened.value = !opened.value
}

function open() {
  opened.value = true
}

function close() {
  opened.value = false
}

// v0.16.8 (firmadapt) — global broadcast channel so the lead detail
// page (Lead.vue) can flip every Section's `opened` state in one
// click for the "Expand all" / "Collapse all" affordances. We use
// window CustomEvents instead of provide/inject because the
// provide/inject + reactive watch path failed to fire reliably on
// the Collapse handler in production builds (likely a minifier
// edge case around two near-identical watchers). Events are
// simpler and unambiguous: dispatch → every Section listener fires.
function onExpandAll() {
  if (props.collapsible) opened.value = true
}
function onCollapseAll() {
  if (props.collapsible) opened.value = false
}
onMounted(() => {
  window.addEventListener('frappe-crm:expand-all-sections', onExpandAll)
  window.addEventListener('frappe-crm:collapse-all-sections', onCollapseAll)
})
onBeforeUnmount(() => {
  window.removeEventListener('frappe-crm:expand-all-sections', onExpandAll)
  window.removeEventListener('frappe-crm:collapse-all-sections', onCollapseAll)
})
</script>
<script>
export default {
  inheritAttrs: false,
}
</script>
