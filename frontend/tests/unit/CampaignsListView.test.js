// Tests for CampaignsListView's STATUS_COLOR mapping.
//
// The SFC owns a script-setup-local `STATUS_COLOR` dict + a
// `getStatusColor()` helper. The map is the contract that prevents
// IndicatorIcon from rendering `!text-undefined-600` when a new
// Autoklose API status value sneaks in.
//
// We don't mount the component here: the parent transitive imports
// pull in `@/utils` → `~icons/lucide/check`, which is resolved by the
// frappe-ui vite plugin in dev/build but NOT loaded by vitest's
// minimal plugin chain. Adding the full frappe-ui plugin would make
// `yarn test:run` boot a real backend proxy (jinjaBootData) for no
// gain — the contract under test is a small literal dict.
//
// Approach: read the SFC source as text, extract the STATUS_COLOR
// literal via a tight regex, eval it through a tiny safe parser, and
// assert against the resulting object. If anyone reshuffles the SFC
// in a way that breaks the regex, the test fails loudly.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const SFC_PATH = resolve(
  __dirname,
  '../../src/components/ListViews/CampaignsListView.vue',
)

function extractStatusColorMap() {
  const src = readFileSync(SFC_PATH, 'utf-8')
  // Find the `const STATUS_COLOR = { ... }` block. Tight match — the
  // dict has no nested braces, so this is safe.
  const m = src.match(/const\s+STATUS_COLOR\s*=\s*\{([\s\S]*?)\}/)
  if (!m) {
    throw new Error('Could not locate STATUS_COLOR literal in SFC source')
  }
  const body = m[1]
  // Parse `key: 'value',` pairs — both keys + values are bare
  // identifiers / single-quoted strings in the SFC.
  const out = {}
  const pairRe = /(\w+)\s*:\s*'([^']+)'/g
  let match
  while ((match = pairRe.exec(body)) !== null) {
    out[match[1]] = match[2]
  }
  return out
}

describe('CampaignsListView STATUS_COLOR map', () => {
  const STATUS_COLOR = extractStatusColorMap()

  it('has entries for every documented Autoklose status', () => {
    // Required values per Autoklose's documented + observed status
    // strings. Drift here means a new status appeared upstream and
    // STATUS_COLOR didn't catch up — the runtime would render the
    // gray fallback, but the indicator wouldn't reflect the real
    // semantic. Tightening this test forces an explicit decision.
    const required = [
      'active',
      'in_progress',
      'pending',
      'paused',
      'draft',
      'finished',
      'archived',
    ]
    for (const status of required) {
      expect(
        STATUS_COLOR[status],
        `STATUS_COLOR is missing key "${status}"`,
      ).toBeDefined()
      expect(typeof STATUS_COLOR[status]).toBe('string')
    }
  })

  it('treats "active" and "in_progress" as synonyms (both green)', () => {
    // /campaigns endpoint returns `active`; /campaign/<id> returns
    // `in_progress` — same running state, same UX color.
    expect(STATUS_COLOR.active).toBe('green')
    expect(STATUS_COLOR.in_progress).toBe('green')
    expect(STATUS_COLOR.active).toBe(STATUS_COLOR.in_progress)
  })

  it('treats "pending" and "paused" as orange (transitional + halted)', () => {
    expect(STATUS_COLOR.pending).toBe('orange')
    expect(STATUS_COLOR.paused).toBe('orange')
  })

  it('finished renders blue', () => {
    expect(STATUS_COLOR.finished).toBe('blue')
  })

  it('draft and archived render gray (no running indicator)', () => {
    expect(STATUS_COLOR.draft).toBe('gray')
    expect(STATUS_COLOR.archived).toBe('gray')
  })

  it('does NOT define unknown statuses (so runtime falls back to gray)', () => {
    // Bug class we're guarding against: parseColor(undefined) yields
    // the broken Tailwind class `!text-undefined-600`. The SFC's
    // getStatusColor() falls back to 'gray' via `|| 'gray'`. We
    // assert (1) the map has no entry for unknown values, and (2)
    // the documented fallback expression resolves to 'gray'.
    expect(STATUS_COLOR.unknown_status_xyz).toBeUndefined()
    const fallback = STATUS_COLOR['unknown_status_xyz'] || 'gray'
    expect(fallback).toBe('gray')
  })
})
