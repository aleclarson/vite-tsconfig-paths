import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
  },
  external: [/^node:/, 'vite', 'debug', 'get-tsconfig', 'oxc-resolver'],
  platform: 'node',
})
