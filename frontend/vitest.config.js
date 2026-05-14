import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  // Vue plugin is required for Vitest to parse .vue SFCs (wave-2
  // component tests mount real components rather than only importing
  // pure JS helpers). vite.config.js ships a full dev/prod stack we
  // skip here — tests don't need it.
  plugins: [vue()],
  test: {
    globals: true,
    environment: 'happy-dom',
    root: __dirname,
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'src/utils/fieldTransforms.js',
        'src/utils/scriptHelpers.js',
        'src/utils/expressions.js',
        'src/utils/renderFieldLayoutDialog.js',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
