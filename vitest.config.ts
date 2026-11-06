import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text-summary', 'html'] },
  },
})
