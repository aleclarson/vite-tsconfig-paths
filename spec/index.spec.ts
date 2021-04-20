import tsPaths from 'vite-tsconfig-paths'
import type { PluginContext } from 'rollup'
import type { PluginOptions } from '../src/types'
import { resolve, loadConfig } from './mocks'
import { Config } from '../src/config'

const configs: { [cwd: string]: Config } = {
  '/a/': {
    configPath: '/a/tsconfig.json',
    baseUrl: '/a',
  },
  '/a/b/': {
    configPath: '/a/b/tsconfig.json',
    baseUrl: '/a/b',
  },
}

describe('tsconfig precedence', () => {
  it('prefers nearest tsconfig', async () => {
    loadConfig.mockImplementation((cwd) => configs[cwd])
    const resolveId = getResolver({
      root: '/a/b',
      // Load the higher config first to prove sorting works.
      projects: ['..', '.'],
    })

    resolve.mockImplementation((id) => id)

    // Import from /a/b/
    let result = await resolveId('c', '/a/b/main.ts')
    expect(result).toBe('/a/b/c')

    // Import from /a/
    result = await resolveId('c', '/a/main.ts')
    expect(result).toBe('/a/c')

    // Import from /
    result = await resolveId('c', '/main.ts')
    expect(result).toBeUndefined()
  })
})

function getResolver(opts?: PluginOptions) {
  const plugin = tsPaths(opts)
  const container: Partial<PluginContext> = {
    async resolve(id, importer) {
      const resolved = resolve(id, importer)
      return resolved && ({ id: resolved } as any)
    },
  }

  plugin.configResolved!({ root: __dirname } as any)
  plugin.buildStart!.call(container as any, {} as any)

  return plugin.resolveId as {
    (id: string, importer?: string): Promise<string | undefined>
  }
}
