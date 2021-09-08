import { dirname, isAbsolute, join, relative, resolve } from './path'
import { normalizePath, Plugin } from 'vite'
import { createMatchPathAsync } from 'tsconfig-paths'
import { crawl } from 'recrawl-sync'
import globRex from 'globrex'
import { PluginOptions } from './types'
import { loadConfig } from './config'

import _debug from 'debug'
const debug = _debug('vite-tsconfig-paths')


type ViteResolve = (id: string, importer: string) => Promise<string | undefined>

type Resolver = (
  viteResolve: ViteResolve,
  id: string,
  importer: string
) => Promise<string | undefined>

export default (opts: PluginOptions = {}): Plugin => {
  let resolvers: Resolver[]

  return {
    name: 'vite:tsconfig-paths',
    enforce: 'pre',
    configResolved(config) {
      const projects = findProjects(config.root, opts)
      const extensions = getFileExtensions(opts.extensions)

      debug('options:', { projects, extensions })
      
      resolvers = projects.map(project => createResolver(project, extensions)).filter(Boolean) as Resolver[]
    },
    async resolveId(id, importer)  {
      const viteResolve = (async (id: string, importer: string) =>
        (await this.resolve(id, importer, { skipSelf: true }))?.id
      )

      if (importer && !relativeImportRE.test(id) && !isAbsolute(id)) {
        for (const resolve of resolvers) {
          const resolved = await resolve(viteResolve, id, importer)
          if (resolved) {
            return resolved
          }
        }
      }
    },
  }

  function createResolver(root: string, extensions: string[]): Resolver | null {
    const configPath = root.endsWith('.json') ? root : null
    if (configPath) root = dirname(root)
    root += '/'

    const config = loadConfig(configPath || root)
    if (!config) {
      debug(`[!] config not found: "${configPath || root}"`)
      return null
    }
    const { baseUrl, paths } = config
    if (!baseUrl) {
      debug(`[!] missing baseUrl: "${config.configPath}"`)
      return null
    }

    debug('config loaded:', config)

    // Even if "paths" is undefined, the "baseUrl" is still
    // used to resolve bare imports.
    let resolveId: Resolver = (viteResolve, id, importer) =>
      viteResolve(join(baseUrl, id), importer)

    if (paths) {
      const matchPath = createMatchPathAsync(baseUrl, paths, mainFields)

      const resolveWithBaseUrl = resolveId
      const resolveWithPaths: Resolver = (viteResolve, id, importer) =>
        new Promise((done) => {
          matchPath(id, void 0, void 0, extensions, (error, path) => {
            if (path) {
              path = normalizePath(path)
              done(viteResolve(path, importer))
            } else {
              error && debug(error.message)
              done(void 0)
            }
          })
        })

      resolveId = (viteResolve, id, importer) =>
        resolveWithPaths(viteResolve, id, importer).then(
          (resolved) => resolved || resolveWithBaseUrl(viteResolve, id, importer)
        )
    }

    const isIncluded = getIncluder(config)

    let importerExtRE = /./
    if (!opts.loose) {
      importerExtRE = config.allowJs
        ? /\.(vue|svelte|mdx|mjs|[jt]sx?)$/
        : /\.tsx?$/
    }

    const resolved = new Map<string, string>()
    return async (viteResolve, id, importer) => {
      importer = normalizePath(importer)
      // Ignore importers with unsupported extensions.
      if (!importerExtRE.test(importer)) return
      // Respect the include/exclude properties.
      if (!isIncluded(relative(root, importer))) return

      let path = resolved.get(id)
      if (!path) {
        path = await resolveId(viteResolve, id, importer)
        if (path) {
          resolved.set(id, path)
          debug(`resolved:`, {
            id,
            importer,
            resolvedId: path,
            configPath: config.configPath,
          })
        }
      }
      return path
    }
  }
}

const relativeImportRE = /^\.\.?(\/|$)/
const mainFields = ['module', 'jsnext', 'jsnext:main', 'browser', 'main']
const defaultInclude = ['**/*']
const defaultExclude = ['node_modules', 'bower_components', 'jspm_packages']

function compileGlob(glob: string) {
  if (!relativeImportRE.test(glob)) {
    glob = './' + glob
  }
  if (!glob.split('/').pop()!.includes('*')) {
    glob += '/**'
  }
  return globRex(glob, {
    extended: true,
    globstar: true,
  }).regex
}

/**
 * The returned function does not support absolute paths.
 * Be sure to call `path.relative` on your path first.
 */
function getIncluder({
  include = defaultInclude,
  exclude = defaultExclude,
  outDir,
}: {
  include?: string[]
  exclude?: string[]
  outDir?: string
}) {
  if (outDir) {
    exclude = exclude.concat(outDir)
  }
  if (include.length || exclude.length) {
    const included = include.map(compileGlob)
    const excluded = exclude.map(compileGlob)
    debug(`compiled globs:`, { included, excluded })
    return (path: string) => {
      if (!relativeImportRE.test(path)) {
        path = './' + path
      }
      const test = (glob: RegExp) => glob.test(path)
      return included.some(test) && !excluded.some(test)
    }
  }
  return () => true
}

function findProjects(viteRoot: string, opts: PluginOptions) {
  const root = opts.root
    ? resolve(viteRoot, normalizePath(opts.root))
    : viteRoot

  let { projects } = opts
  if (!projects) {
    debug(`crawling "${root}"`)
    projects = crawl(root, {
      only: ['tsconfig.json'],
      skip: ['node_modules', '.git'],
    })
  }

  // Calculate the depth of each project path.
  const depthMap: { [path: string]: number } = {}
  projects = projects.map((projectPath) => {
    projectPath = resolve(root, normalizePath(projectPath))
    depthMap[projectPath] =
      projectPath.split('/').length - (projectPath.endsWith('.json') ? 1 : 0)
    return projectPath
  })

  // Ensure deeper projects take precedence.
  return projects.sort((a, b) => depthMap[b] - depthMap[a])
}

function getFileExtensions(exts?: string[]) {
  const requiredExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
  return exts ? exts.concat(requiredExts) : requiredExts
}
