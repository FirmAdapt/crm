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
    <transition
      enter-active-class="duration-300 ease-in"
      leave-active-class="duration-300 ease-[cubic-bezier(0, 1, 0.5, 1)]"
      enter-to-class="max-h-[200px] overflow-hidden"
      leave-from-class="max-h-[200px] overflow-hidden"
      enter-from-class="max-h-0 overflow-hidden"
      leave-to-class="max-h-0 overflow-hidden"
    >
      <div v-show="opened" class="columns" v-bind="$attrs">
        <slot v-bind="{ opened, open, close, toggle }" />
      </div>
    </transition>
  </div>
</template>
<script setup>
import { ref, inject, watch } from 'vue'

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

// v0.16.8 (firmadapt) — optional broadcast channel so an ancestor
// (Lead.vue) can flip every Section's `opened` state in one shot
// for the "Expand all" / "Collapse all" affordances added to the
// lead detail page header. The signal is a ref whose `.value` is a
// `{ expand, collapse }` pair of monotonically-increasing counters;
// sections watch each counter separately so re-clicking the same
// button re-applies the state (so a user can expand all → manually
// collapse one → expand all again and get back to full).
const sectionExpandSignal = inject('sectionExpandSignal', null)
if (sectionExpandSignal) {
  watch(
    () => sectionExpandSignal.value?.expand,
    () => {
      if (props.collapsible) opened.value = true
    },
  )
  watch(
    () => sectionExpandSignal.value?.collapse,
    () => {
      if (props.collapsible) opened.value = false
    },
  )
}
</script>
<script>
export default {
  inheritAttrs: false,
}
</script>
