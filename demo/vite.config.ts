import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    tsconfigPaths({
      parseNative: false,
    }),
    // {
    //   name: 'measure-startup-time-and-quit',
    //   resolveId() {
    //     console.log('Startup time:', process.uptime() + 's')
    //     process.exit()
    //   },
    // },
  ],
})
