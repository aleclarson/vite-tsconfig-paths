import { klona } from 'klona'
import { Config } from '../src/config'

/** Rollup `resolve` method for plugins */
export const resolve = jest.fn<string | null, [string, string?]>()

type ConfigModule = jest.Mocked<typeof import('../src/config')>
type MatchModule = jest.Mocked<typeof import('tsconfig-paths')>

const { loadConfig }: ConfigModule = jest.createMockFromModule('../src/config')
const { createMatchPathAsync }: MatchModule = jest.createMockFromModule(
  'tsconfig-paths'
)

export { createMatchPathAsync, loadConfig }

export let configs: { [cwd: string]: Config } = {
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
beforeEach(() => {
  configs = klona(initialConfigs)
  loadConfig.mockImplementation((cwd) => configs[cwd])
})

afterEach(() => {
  jest.resetAllMocks()
})
