import { normalizePath, Plugin } from 'vite'
import { createMatchPath, loadConfig } from 'tsconfig-paths'
import { loadTsconfig } from 'tsconfig-paths/lib/tsconfig-loader'
import { resolve } from 'path'

const debug = require('debug')('vite-tsconfig-paths')

type PluginOptions = {
  /**
   * The root directory to load `tsconfig.json` from.
   *
   * @default viteConfig.root
   */
  root?: string
  /**
   * Implicit extensions used when resolving an import path
   * like `./App` which has no explicit extension like `./App.vue` does.
   *
   * TypeScript and JavaScript extensions are used by default.
   */
  extensions?: string[]
}

export default (opts: PluginOptions = {}): Plugin => ({
  name: 'vite:tsconfig-paths',
  enforce: 'pre',
  configResolved({ root, logger }) {
    root = (opts.root ? normalizePath(resolve(root, opts.root)) : root) + '/'

    const config = loadConfig(root)
    if (config.resultType == 'failed') {
      logger.warn(`[vite-tsconfig-paths] ${config.message}`)
    } else if (config.paths) {
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

      const { checkJs } = loadCompilerOptions(config.configFileAbsolutePath)
      const importerExtRE = checkJs ? /\.(vue|svelte|mdx|mjs|[jt]sx?)$/ : /\.tsx?$/

      const resolved = new Map<string, string>()
      this.resolveId = async function (id, importer) {
        if (!importer || !importerExtRE.test(importer)) {
          return null
        }
        let path = resolved.get(id)
        if (!path && isLocalDescendant(importer, root)) {
          path = matchPath(
            id,
            undefined,
            undefined,
            opts.extensions?.concat(implicitExtensions) || implicitExtensions
          )
          if (path) {
            path = normalizePath(path)

            const resolution = await this.resolve(path, importer, {
              skipSelf: true,
            })

            if (!resolution) {
              return null
            }

            resolved.set(id, (path = resolution.id))
            debug(`resolved "${id}" to "${path}"`)
          }
        }
        return path
      }
    }
  },
})

const nodeModulesRE = /\/node_modules\//

/** Returns true when `path` is within `root` and not an installed dependency. */
function isLocalDescendant(path: string, root: string) {
  return path.startsWith(root) && !nodeModulesRE.test(path.slice(root.length))
}

const implicitExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

interface CompilerOptions {
  checkJs?: boolean
}

function loadCompilerOptions(configPath: string): CompilerOptions {
  const config: any = loadTsconfig(configPath)
  return config.compilerOptions
}
