/** Rollup `resolve` method for plugins */
export const resolve = jest.fn<string | null, [string, string?]>()

type ConfigModule = jest.Mocked<typeof import('../src/config')>
type MatchModule = jest.Mocked<typeof import('tsconfig-paths')>

const { loadConfig }: ConfigModule = jest.createMockFromModule('../src/config')
const { createMatchPathAsync }: MatchModule = jest.createMockFromModule(
  'tsconfig-paths'
)

export { createMatchPathAsync, loadConfig }

afterEach(() => {
  jest.resetAllMocks()
})
