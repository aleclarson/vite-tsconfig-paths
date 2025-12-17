import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    globals: true,
    isolate: false,
    testTimeout: 10000,
    sequence: {
      // CI runs tests sequentially for easier debugging
      concurrent: !process.env.CI,
    },
    env: {
      TEST: 'vite-tsconfig-paths',
    },
  },
})
