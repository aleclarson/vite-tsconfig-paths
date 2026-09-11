import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: 'esm',
  dts: {
    sourcemap: true,
  },
  sourcemap: true,
  platform: 'node',
  fixedExtension: false,
  target: 'es2018',
})
