import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
  },
  external: [/^node:/, 'vite', 'obug', 'get-tsconfig', 'oxc-resolver'],
  platform: 'node',
})
