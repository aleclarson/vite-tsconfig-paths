import type { Plugin } from 'vite'
import { relative, resolve, sep } from 'path'
import { createMatchPath, loadConfig } from 'tsconfig-paths'

const debug = require('debug')('vite-tsconfig-paths')

type PluginOptions = {
  /**
   * The root directory to load `tsconfig.json` from.
   *
   * @default viteConfig.root
   */
  root?: string
  /**
   * File extensions to search for.
   *
   * @default Object.keys(require.extensions)
   */
  extensions?: string[]
}

export default (opts: PluginOptions = {}): Plugin => ({
  name: 'vite:tsconfig-paths',
  enforce: 'pre',
  configResolved({ root, logger }) {
    root = resolve(opts.root || root) + sep

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
      const resolved = new Map<string, string>()
      this.resolveId = (id) => {
        if (!importer || !/\.tsx?$/.test(importer)) {
          return null
        }
        let path = resolved.get(id)
        if (!path && isLocalDescendant(importer, root)) {
          path = matchPath(id, undefined, undefined, opts.extensions)
          if (path) {
            resolved.set(id, (path = '/' + relative(process.cwd(), path)))
            debug(`resolved "${id}" to "${path}"`)
          }
        }
        return path
      }
    }
  },
})

const nodeModulesRE = /\bnode_modules\b/

/** Returns true when `path` is within `root` and not an installed dependency. */
function isLocalDescendant(path: string, root: string) {
  return path.startsWith(root) && !nodeModulesRE.test(path.slice(root.length))
}
