import tsPaths from 'vite-tsconfig-paths'
import type { PluginContext } from 'rollup'
import type { PluginOptions } from '../src/types'
import { resolve } from './mocks'

describe('tsconfig precedence', () => {
  it('prefers nearest tsconfig', async () => {
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

describe('absolute paths in projects array', () => {
  test('posix paths', async () => {
    const resolveId = getResolver({
      projects: ['/a/b'],
    })
    resolve.mockImplementation((id) => id)
    const result = await resolveId('c', '/a/b/b/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/b/c"`)
  })
  test('windows-style paths', async () => {
    const resolveId = getResolver({
      projects: ['D:\\a\\b'],
    })
    resolve.mockImplementation((id) => id)
    const result = await resolveId('c', 'D:\\a\\b\\b\\main.ts')
    expect(result).toBeDefined()
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
