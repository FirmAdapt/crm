// Minimal globals that CRM code expects
const __ = (msg, args) => {
  if (!args) return msg
  let str = msg
  if (Array.isArray(args)) {
    args.forEach((arg, i) => {
      str = str.replace(`{${i}}`, arg)
    })
  }
  return str
}
globalThis.__ = __

globalThis.window = globalThis.window || {}
globalThis.window.sysdefaults = { currency: 'USD' }

// Vue templates resolve `__` via the component proxy (`_ctx.__()`),
// not via the global scope — without this config, mounting a SFC that
// uses `__('…')` in its template throws `_ctx.__ is not a function`.
// @vue/test-utils exposes a global config that applies to every
// `mount()` call, so register the helper here once.
import { config } from '@vue/test-utils'
config.global.mocks = { ...config.global.mocks, __ }
