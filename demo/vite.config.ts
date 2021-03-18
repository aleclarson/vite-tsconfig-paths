import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'path'
import svelte from '@svitejs/vite-plugin-svelte'
import type { UserConfig } from 'vite'

const config: UserConfig = {
  resolve: {
    alias: {
      svelte: resolve(__dirname, 'node_modules/svelte'),
      // $: resolve(__dirname, './src'),
    },
  },
  plugins: [svelte(), tsconfigPaths()],
}

export default config
