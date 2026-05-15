<template>
  <!-- Card layout mirrors the existing SPA chrome (rounded border-outline-
       gray-1, subtle bg). Color accent on the title comes from a
       parseColor() Tailwind class — same palette the Campaign status
       badges use, so the visual language stays consistent. -->
  <div class="rounded-lg border border-outline-gray-1 p-5 hover:bg-surface-menu-bar">
    <div class="flex items-baseline justify-between gap-3">
      <div>
        <h3
          class="text-base font-medium"
          :class="parseColor(color)"
        >
          {{ name }}
        </h3>
        <div class="mt-0.5 text-xs text-ink-gray-5">
          {{ tagline }}
        </div>
      </div>
    </div>
    <p class="mt-3 text-sm text-ink-gray-7 leading-relaxed">
      {{ description }}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <template v-for="link in links" :key="link.label">
        <!-- Two link shapes: external href (opens /app/<doctype> in a new
             tab; admin's Desk session is shared so they're already
             logged in) OR an internal vue-router push. -->
        <a
          v-if="link.href"
          :href="link.href"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-1 rounded-md border border-outline-gray-2 bg-surface-white px-3 py-1.5 text-xs font-medium text-ink-gray-8 hover:bg-surface-gray-2 transition-colors"
        >
          {{ link.label }}
          <FeatherIcon name="external-link" class="h-3 w-3" />
        </a>
        <router-link
          v-else-if="link.route"
          :to="link.route"
          class="inline-flex items-center gap-1 rounded-md border border-outline-gray-2 bg-surface-white px-3 py-1.5 text-xs font-medium text-ink-gray-8 hover:bg-surface-gray-2 transition-colors"
        >
          {{ link.label }}
          <FeatherIcon name="arrow-right" class="h-3 w-3" />
        </router-link>
      </template>
    </div>
  </div>
</template>

<script setup>
import { FeatherIcon } from 'frappe-ui'
import { parseColor } from '@/utils'

defineProps({
  slug: { type: String, required: true },
  name: { type: String, required: true },
  tagline: { type: String, required: true },
  description: { type: String, required: true },
  // One of the colors that parseColor() recognises: blue, green, red,
  // orange, gray, etc. Used for the title accent only.
  color: { type: String, default: 'gray' },
  // Array of { label, href? } | { label, route? }. href opens /app
  // in a new tab; route is an internal router-link push.
  links: { type: Array, required: true },
})
</script>
