import * as fs from 'fs'
import { resolve } from 'path'
import { inspect } from 'util'
import _debug from 'debug'
import globRex from 'globrex'
import * as tsconfck from 'tsconfck'
import type { CompilerOptions } from 'typescript'
import { Plugin, normalizePath, searchForWorkspaceRoot } from 'vite'
import { resolvePathMappings } from './mappings'
import { basename, dirname, isAbsolute, join, relative } from './path'
import { PluginOptions } from './types'

const debug = _debug('vite-tsconfig-paths')

const noMatch = [undefined, false] as [undefined, false]

type ViteResolve = (id: string, importer: string) => Promise<string | undefined>

type Resolver = (
  viteResolve: ViteResolve,
  id: string,
  importer: string
) => Promise<[resolved: string | undefined, matched: boolean]>

export type { PluginOptions }

export default (opts: PluginOptions = {}): Plugin => {
  let resolversByDir: Record<string, Resolver[]>

  return {
    name: 'vite-tsconfig-paths',
    enforce: 'pre',
    async configResolved(config) {
      let projectRoot = config.root
      let workspaceRoot!: string

      let { root } = opts
      if (root) {
        root = resolve(projectRoot, root)
      } else {
        workspaceRoot = searchForWorkspaceRoot(projectRoot)
      }

      debug('options.root   ==', root)
      debug('project root   ==', projectRoot)
      debug('workspace root ==', workspaceRoot)

      // The "root" option overrides both of these.
      if (root) {
        projectRoot = root
        workspaceRoot = root
      }

      const projects = await resolveProjectPaths(
        opts.projects,
        projectRoot,
        workspaceRoot
      )

      debug('projects:', projects)

      let hasTypeScriptDep = false
      if (opts.parseNative) {
        try {
          const pkgJson = fs.readFileSync(
            join(workspaceRoot, 'package.json'),
            'utf8'
          )
          const pkg = JSON.parse(pkgJson)
          const deps = { ...pkg.dependencies, ...pkg.devDependencies }
          hasTypeScriptDep = 'typescript' in deps
        } catch (e: any) {
          if (e.code != 'ENOENT') {
            throw e
          }
        }
      }

      const parsedProjects = new Set(
        await Promise.all(
          projects.map((tsconfigFile) =>
            hasTypeScriptDep
              ? tsconfck.parseNative(tsconfigFile)
              : tsconfck.parse(tsconfigFile)
          )
        )
      )

      resolversByDir = {}
      parsedProjects.forEach((project) => {
        const resolver = createResolver(project)
        if (resolver) {
          const projectDir = dirname(project.tsconfigFile)
          const resolvers = (resolversByDir[projectDir] ||= [])
          resolvers.push(resolver)
        }
      })
    },
    async resolveId(id, importer) {
      if (importer && !relativeImportRE.test(id) && !isAbsolute(id)) {
        const viteResolve: ViteResolve = async (id, importer) =>
          (await this.resolve(id, importer, { skipSelf: true }))?.id

        let prevProjectDir: string | undefined
        let projectDir = dirname(importer)

        // Find the nearest directory with a matching tsconfig file.
        loop: while (projectDir && projectDir != prevProjectDir) {
          const resolvers = resolversByDir[projectDir]
          if (resolvers)
            for (const resolve of resolvers) {
              const [resolved, matched] = await resolve(
                viteResolve,
                id,
                importer
              )
              if (resolved) {
                return resolved
              }
              if (matched) {
                // Once a matching resolver is found, stop looking.
                break loop
              }
            }
          prevProjectDir = projectDir
          projectDir = dirname(prevProjectDir)
        }
      }
    },
  }

  function createResolver(
    project: tsconfck.TSConfckParseResult
  ): Resolver | null {
    const configPath = project.tsconfigFile
    const configDir = dirname(configPath)
    const config = project.tsconfig as {
      include?: string[]
      exclude?: string[]
      compilerOptions: CompilerOptions
    }
    const options = config.compilerOptions
    debug('config loaded:', inspect({ configPath, config }, false, 10, true))

    const { baseUrl, paths } = options
    if (!baseUrl && !paths) {
      debug(`[!] missing baseUrl and paths: "${configPath}"`)
      return null
    }

    type InternalResolver = (
      viteResolve: ViteResolve,
      id: string,
      importer: string
    ) => Promise<string | undefined>

    const resolveWithBaseUrl: InternalResolver | undefined = baseUrl
      ? (viteResolve, id, importer) => viteResolve(join(baseUrl, id), importer)
      : undefined

    let resolveId: InternalResolver
    if (paths) {
      const pathMappings = resolvePathMappings(
        paths,
        options.baseUrl ?? dirname(configPath)
      )
      const resolveWithPaths: InternalResolver = async (
        viteResolve,
        id,
        importer
      ) => {
        for (const mapping of pathMappings) {
          const match = id.match(mapping.pattern)
          if (!match) {
            continue
          }
          for (let pathTemplate of mapping.paths) {
            let starCount = 0
            const mappedId = pathTemplate.replace(/\*/g, () => {
              // There may exist more globs in the path template than in
              // the match pattern. In that case, we reuse the final
              // glob match.
              const matchIndex = Math.min(++starCount, match.length - 1)
              return match[matchIndex]
            })
            const resolved = await viteResolve(mappedId, importer)
            if (resolved) {
              return resolved
            }
          }
        }
      }

      if (resolveWithBaseUrl) {
        resolveId = (viteResolve, id, importer) =>
          resolveWithPaths(viteResolve, id, importer).then((resolved) => {
            return resolved ?? resolveWithBaseUrl(viteResolve, id, importer)
          })
      } else {
        resolveId = resolveWithPaths
      }
    } else {
      resolveId = resolveWithBaseUrl!
    }

    // When `tsconfck.parseNative` is used, the outDir is absolute,
    // which is not what `getIncluder` expects.
    let { outDir } = options
    if (outDir && isAbsolute(outDir)) {
      outDir = relative(configDir, outDir)
    }

    const isIncludedRelative = getIncluder(
      config.include,
      config.exclude,
      outDir
    )

    const importerExtRE = opts.loose
      ? /./
      : options.allowJs || basename(configPath).startsWith('jsconfig.')
      ? jsLikeRE
      : /\.[mc]?tsx?$/

    const resolutionCache = new Map<string, string>()
    return async (viteResolve, id, importer) => {
      // Skip virtual modules.
      if (id.includes('\0')) {
        return noMatch
      }

      importer = normalizePath(importer)
      const importerFile = importer.replace(/[#?].+$/, '')

      // Ignore importers with unsupported extensions.
      if (!importerExtRE.test(importerFile)) {
        return noMatch
      }

      // Respect the include/exclude properties.
      const relativeImporterFile = relative(configDir, importerFile)
      if (!isIncludedRelative(relativeImporterFile)) {
        return noMatch
      }

      // Find and remove Vite's suffix (e.g. "?url") if present.
      // If the path is resolved, the suffix will be added back.
      const suffix = /\?.+$/.exec(id)?.[0]
      if (suffix) {
        id = id.slice(0, -suffix.length)
      }

      let path = resolutionCache.get(id)
      if (!path) {
        path = await resolveId(viteResolve, id, importer)
        if (path) {
          resolutionCache.set(id, path)
          debug(`resolved:`, {
            id,
            importer,
            resolvedId: path,
            configPath,
          })
        }
      }
      return [path && suffix ? path + suffix : path, true]
    }
  }
}

const jsLikeRE = /\.(vue|svelte|mdx|[mc]?[jt]sx?)$/
const relativeImportRE = /^\.\.?(\/|$)/
const defaultInclude = ['**/*']
const defaultExclude = [
  '**/node_modules',
  '**/bower_components',
  '**/jspm_packages',
]

/**
 * The returned function does not support absolute paths.
 * Be sure to call `path.relative` on your path first.
 */
function getIncluder(
  includePaths = defaultInclude,
  excludePaths = defaultExclude,
  outDir?: string
) {
  if (outDir) {
    excludePaths = excludePaths.concat(outDir)
  }
  if (includePaths.length || excludePaths.length) {
    const includers: RegExp[] = []
    const excluders: RegExp[] = []

    includePaths.forEach(addCompiledGlob, includers)
    excludePaths.forEach(addCompiledGlob, excluders)
    debug(`compiled globs:`, { includers, excluders })

    return (path: string) => {
      path = path.replace(/\?.+$/, '')
      if (!relativeImportRE.test(path)) {
        path = './' + path
      }
      const test = (glob: RegExp) => glob.test(path)
      return includers.some(test) && !excluders.some(test)
    }
  }
  return () => true
}

function addCompiledGlob(this: RegExp[], glob: string) {
  const endsWithGlob = glob.split('/').pop()!.includes('*')
  const relativeGlob = relativeImportRE.test(glob) ? glob : './' + glob
  if (!endsWithGlob) {
    this.push(compileGlob(relativeGlob + '/**'))
  }
  if (jsLikeRE.test(glob)) {
    this.push(compileGlob(relativeGlob))
  }
}

function compileGlob(glob: string) {
  return globRex(glob, {
    extended: true,
    globstar: true,
  }).regex
}

function resolveProjectPaths(
  projects: string[] | undefined,
  projectRoot: string,
  workspaceRoot: string
) {
  if (projects) {
    return projects.map((file) => {
      if (!file.endsWith('.json')) {
        file = join(file, 'tsconfig.json')
      }
      return resolve(projectRoot, file)
    })
  }
  return tsconfck.findAll(workspaceRoot, {
    skip(dir) {
      return dir == 'node_modules' || dir == '.git'
    },
  })
}
