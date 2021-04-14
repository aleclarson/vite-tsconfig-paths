import { resolve, isAbsolute } from 'path'
import { normalizePath, Plugin } from 'vite'
import { createMatchPath, loadConfig } from 'tsconfig-paths'
import { loadTsconfig } from 'tsconfig-paths/lib/tsconfig-loader'

const debug = require('debug')('vite-tsconfig-paths')

type PluginOptions = {
  /**
   * The root directories to load `tsconfig.json` from.
   *
   * @default [viteConfig.root]
   */
  projects?: string[]
  /**
   * Implicit extensions used when resolving an import path
   * like `./App` which has no explicit extension like `./App.vue` does.
   *
   * TypeScript and JavaScript extensions are used by default.
   */
  extensions?: string[]
  /**
   * Disable strictness that limits path resolution to TypeScript
   * and JavaScript modules.
   *
   * Useful if you want asset URLs in Vue templates to be resolved,
   * or when `"checkJs": true` in your tsconfig isn't good enough.
   */
  loose?: boolean
}

export default (opts: PluginOptions = {}): Plugin => ({
  name: 'vite:tsconfig-paths',
  enforce: 'pre',
  configResolved({ root, logger }) {
    const resolvers = (opts.projects || [root])
      .map(createResolver)
      .filter(Boolean) as Resolver[]

    this.resolveId = async function (id, importer) {
      if (importer && !relativeImportRE.test(id) && !isAbsolute(id)) {
        const viteResolve = async (id: string) =>
          (await this.resolve(id, importer, { skipSelf: true }))?.id

        for (const resolve of resolvers) {
          const resolved = await resolve(id, importer, viteResolve)
          if (resolved) {
            return resolved
          }
        }
      }
    }

    type Resolver = (
      id: string,
      importer: string,
      viteResolve: (id: string) => Promise<string | undefined>
    ) => Promise<string | undefined>

    function createResolver(configRoot: string): Resolver | null {
      configRoot =
        (configRoot ? normalizePath(resolve(root, configRoot)) : configRoot) +
        '/'

      const config = loadConfig(configRoot)
      if (config.resultType == 'failed') {
        logger.warn(`[vite-tsconfig-paths] ${config.message}`)
        return null
      }
      if (!config.paths) {
        return null
      }

      const matchPath = createMatchPath(
        config.absoluteBaseUrl,
        config.paths,
        config.mainFields || [
          'module',
          'jsnext',
          'jsnext:main',
          'browser',
          'main',
        ],
        config.addMatchAll
      )

      let importerExtRE = /./
      if (!opts.loose) {
        const { allowJs, checkJs } = loadCompilerOptions(
          config.configFileAbsolutePath
        )
        importerExtRE =
          allowJs || checkJs //
            ? /\.(vue|svelte|mdx|mjs|[jt]sx?)$/
            : /\.tsx?$/
      }

      const resolved = new Map<string, string>()
      return async (id, importer, viteResolve) => {
        if (importerExtRE.test(importer)) {
          let path = resolved.get(id)
          if (!path && isLocalDescendant(importer, configRoot)) {
            path = matchPath(
              id,
              undefined,
              undefined,
              opts.extensions?.concat(implicitExtensions) || implicitExtensions
            )
            if (path) {
              path = normalizePath(path)
              path = await viteResolve(path)
              if (path) {
                resolved.set(id, path)
                debug(`resolved "${id}" to "${path}"`)
              }
            }
          }
          return path
        }
      }
    }
  },
})

const nodeModulesRE = /\/node_modules\//
const relativeImportRE = /^\.\.?(\/|$)/

/** Returns true when `path` is within `root` and not an installed dependency. */
function isLocalDescendant(path: string, root: string) {
  return path.startsWith(root) && !nodeModulesRE.test(path.slice(root.length))
}

const implicitExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

interface CompilerOptions {
  allowJs?: boolean
  checkJs?: boolean
}

function loadCompilerOptions(configPath: string): CompilerOptions {
  const config: any = loadTsconfig(configPath)
  return config.compilerOptions
}
