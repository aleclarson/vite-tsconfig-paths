import tsconfigPaths from 'vite-tsconfig-paths'
import reactRefresh from '@vitejs/plugin-react-refresh'
import type { UserConfig } from 'vite'

const config: UserConfig = {
  plugins: [
    reactRefresh(), //
    tsconfigPaths(),
  ],
}

export default config
