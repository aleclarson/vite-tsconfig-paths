import tsPaths from 'vite-tsconfig-paths'
import type { PluginContext } from 'rollup'
import type { PluginOptions } from '../src/types'
import { resolve } from '../src/path'
import { viteResolve } from './mocks'

const isWindows = 'win32' == jest.requireActual('os').platform()

export { viteResolve }

export function getResolver(opts?: PluginOptions) {
  const plugin = tsPaths(opts)
  const container: Partial<PluginContext> = {
    async resolve(id, importer) {
      const resolved = viteResolve(id, importer)
      return resolved && ({ id: resolved } as any)
    },
  }

  plugin.configResolved!({ root: __dirname } as any)
  plugin.buildStart!.call(container as any, {} as any)

  const resolveId = plugin.resolveId as (
    id: string,
    importer?: string
  ) => Promise<string | undefined>

  return async (id: string, importer?: string) => {
    const expectsPosix = importer?.[0] == '/'
    if (isWindows && expectsPosix) {
      importer = resolve(importer!)
    }
    const resolved = await resolveId(id, importer)
    if (resolved) {
      // Strip the D: prefix on Windows if the importer was a Posix-style path.
      return isWindows && expectsPosix ? resolved.slice(2) : resolved
    }
  }
}
