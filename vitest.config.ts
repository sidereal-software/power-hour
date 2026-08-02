import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Playwright specs live in e2e/ and are driven by playwright.config.ts.
    exclude: ['node_modules', 'dist', 'e2e'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/lib/**', 'src/hooks/**', 'src/components/**'],
      // Vendored shadcn source and pure-presentation shells aren't ours to prove.
      exclude: ['src/components/ui/**', 'src/lib/spotify-types.ts', 'src/**/*.d.ts'],
      // Ratcheted to just under what the suite currently achieves, so a drop
      // in coverage fails CI rather than sliding quietly.
      thresholds: {
        lines: 95,
        functions: 88,
        branches: 85,
        statements: 94,
      },
    },
  },
})
