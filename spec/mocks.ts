import { klona } from 'klona'
import type { Config } from '../src/config'

type ConfigModule = jest.Mocked<typeof import('../src/config')>
type MatchModule = jest.Mocked<typeof import('tsconfig-paths')>

const { loadConfig }: ConfigModule = jest.createMockFromModule('../src/config')
const { createMatchPathAsync }: MatchModule = jest.createMockFromModule(
  'tsconfig-paths'
)

jest.mock('tsconfig-paths', () => ({
  createMatchPathAsync,
}))

jest.mock('../src/config', () => ({
  loadConfig,
}))

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  // Since the "path.win32" module supports both /^\// and /^[A-Z]:[\\/]/
  // path formats, we can use it to test windows-style paths without
  // breaking the tests for posix-style paths.
  platform: () => 'win32',
}))

export { createMatchPathAsync, loadConfig }

/** Mock the implementation of Vite's resolver */
export const viteResolve = jest.fn<string | null, [string, string?]>()

/** The `loadConfig` mock uses this config cache by default. */
export let configs: {
  [root: string]: Config | undefined
} = {
  '/a/': {
    configPath: '/a/tsconfig.json',
    baseUrl: '/a',
  },
  '/a/b/': {
    configPath: '/a/b/tsconfig.json',
    baseUrl: '/a/b',
  },
}

const initialConfigs = configs
export function resetConfigs() {
  configs = klona(initialConfigs)
}
