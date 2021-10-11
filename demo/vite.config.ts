import tsconfigPaths from 'vite-tsconfig-paths'
import react from '@vitejs/plugin-react'
import type { UserConfig } from 'vite'

const config: UserConfig = {
  plugins: [react(), tsconfigPaths()],
}

export default config
