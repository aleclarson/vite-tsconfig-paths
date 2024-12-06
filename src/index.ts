import _debug from 'debug'
import * as fs from 'fs'
import globRex from 'globrex'
import { resolve } from 'path'
import type {
  TSConfckParseNativeResult,
  TSConfckParseOptions,
  TSConfckParseResult,
} from 'tsconfck'
import type { CompilerOptions } from 'typescript'
import { inspect } from 'util'
import { normalizePath, Plugin, searchForWorkspaceRoot } from 'vite'
import { resolvePathMappings } from './mappings'
import { basename, dirname, isAbsolute, join, relative } from './path'
import { PluginOptions } from './types'
import { debug, debugResolve } from './debug'

const notApplicable = [undefined, false] as const
const notFound = [undefined, true] as const

type ViteResolve = (id: string, importer: string) => Promise<string | undefined>

type Resolver = (
  viteResolve: ViteResolve,
  id: string,
  importer: string
) => Promise<readonly [resolved: string | undefined, matched: boolean]>

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

      const tsconfck = await import('tsconfck')

      const projects = opts.projects
        ? opts.projects.map((file) => {
            if (!file.endsWith('.json')) {
              file = join(file, 'tsconfig.json')
            }
            return resolve(projectRoot, file)
          })
        : await tsconfck.findAll(workspaceRoot, {
            configNames: opts.configNames || ['tsconfig.json', 'jsconfig.json'],
            skip(dir) {
              if (dir === '.git' || dir === 'node_modules') {
                return true
              }
              if (typeof opts.skip === 'function') {
                return opts.skip(dir)
              }
              return false
            },
          })

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

      let firstError: any

      const parseOptions: TSConfckParseOptions = {
        cache: new tsconfck.TSConfckCache(),
      }

      const parsedProjects = new Set(
        await Promise.all(
          projects.map((tsconfigFile) => {
            if (tsconfigFile === null) {
              debug('tsconfig file not found:', tsconfigFile)
              return null
            }
            return (
              hasTypeScriptDep
                ? tsconfck.parseNative(tsconfigFile, parseOptions)
                : tsconfck.parse(tsconfigFile, parseOptions)
            ).catch((error) => {
              if (opts.ignoreConfigErrors) {
                debug('tsconfig file caused a parsing error:', tsconfigFile)
              } else {
                config.logger.error(
                  '[tsconfig-paths] An error occurred while parsing "' +
                    tsconfigFile +
                    '". See below for details.' +
                    (firstError
                      ? ''
                      : ' To disable this message, set the `ignoreConfigErrors` option to true.'),
                  { error }
                )
                if (config.logger.hasErrorLogged(error)) {
                  console.error(error)
                }
                firstError = error
              }
              return null
            })
          })
        )
      )

      resolversByDir = {}
      parsedProjects.forEach((project) => {
        if (!project) {
          return
        }
        // Don't create a resolver for projects with a references array.
        // Instead, create a resolver for each project in that array.
        if (project.referenced) {
          project.referenced.forEach((projectRef) => {
            parsedProjects.add(projectRef)
          })
          // Reinsert the parent project so it's tried last. This is
          // important because project references can be used to
          // override the parent project.
          parsedProjects.delete(project)
          parsedProjects.add(project)
          project.referenced = undefined
        } else {
          const resolver = createResolver(project)
          if (resolver) {
            const projectDir = normalizePath(dirname(project.tsconfigFile))
            const resolvers = (resolversByDir[projectDir] ||= [])
            resolvers.push(resolver)
          }
        }
      })
    },
    async resolveId(id, importer, options) {
      if (debugResolve.enabled) {
        debugResolve('resolving:', { id, importer })
      }

      if (!importer) {
        debugResolve('importer is empty or undefined. skipping...')
        return
      }
      if (relativeImportRE.test(id)) {
        debugResolve('id is a relative import. skipping...')
        return
      }
      if (isAbsolute(id)) {
        debugResolve('id is an absolute path. skipping...')
        return
      }
      if (id.includes('\0')) {
        debugResolve('id is a virtual module. skipping...')
        return
      }

      // For Vite 4 and under, skipSelf needs to be set.
      const resolveOptions = { ...options, skipSelf: true }
      const viteResolve: ViteResolve = async (id, importer) =>
        (await this.resolve(id, importer, resolveOptions))?.id

      let prevProjectDir: string | undefined
      let projectDir = normalizePath(dirname(importer))

      // Find the nearest directory with a matching tsconfig file.
      loop: while (projectDir && projectDir != prevProjectDir) {
        const resolvers = resolversByDir[projectDir]
        if (resolvers) {
          for (const resolve of resolvers) {
            const [resolved, matched] = await resolve(viteResolve, id, importer)
            if (resolved) {
              return resolved
            }
            if (matched) {
              // Once a matching resolver is found, stop looking.
              break loop
            }
          }
        }
        prevProjectDir = projectDir
        projectDir = dirname(prevProjectDir)
      }
    },
  }

  type TsConfig = {
    files?: string[]
    include?: string[]
    exclude?: string[]
    compilerOptions?: CompilerOptions
  }

  function resolvePathsRootDir(
    project: TSConfckParseResult | TSConfckParseNativeResult
  ): string {
    if ('result' in project) {
      return (
        project.result.options?.pathsBasePath ?? dirname(project.tsconfigFile)
      )
    }
    const baseUrl = (project.tsconfig as TsConfig).compilerOptions?.baseUrl
    if (baseUrl) {
      return baseUrl
    }
    const projectWithPaths = project.extended?.find(
      (p) => (p.tsconfig as TsConfig).compilerOptions?.paths
    )
    return dirname((projectWithPaths ?? project).tsconfigFile)
  }

  function createResolver(
    project: TSConfckParseResult | TSConfckParseNativeResult
  ): Resolver | null {
    const configPath = normalizePath(project.tsconfigFile)
    const config = project.tsconfig as TsConfig

    debug('config loaded:', inspect({ configPath, config }, false, 10, true))

    // Sometimes a tsconfig is not meant to be used for path resolution,
    // but rather for pointing to other tsconfig files and possibly
    // being extended by them. This is represented by an explicitly
    // empty "files" array and a missing/empty "include" array.
    if (config.files?.length == 0 && !config.include?.length) {
      debug(
        `[!] skipping "${configPath}" as no files can be matched since "files" is empty and "include" is missing or empty`
      )
      return null
    }

    const options = config.compilerOptions || {}
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
      ? (viteResolve, id, importer) => {
          const absoluteId = join(baseUrl, id)
          debugResolve('trying with baseUrl:', absoluteId)
          return viteResolve(absoluteId, importer)
        }
      : undefined

    let resolveId: InternalResolver
    if (paths) {
      const pathsRootDir = resolvePathsRootDir(project)
      const pathMappings = resolvePathMappings(paths, pathsRootDir)

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
            debugResolve('found match, trying to resolve:', mappedId)
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

    const configDir = dirname(configPath)

    // When `tsconfck.parseNative` is used, the outDir is absolute,
    // which is not what `getIncluder` expects.
    let { outDir } = options
    if (outDir && isAbsolute(outDir)) {
      outDir = relative(configDir, outDir)
    }

    const isIncludedRelative = getIncluder(
      config.include?.map((p) => ensureRelative(configDir, p)),
      config.exclude?.map((p) => ensureRelative(configDir, p)),
      outDir
    )

    const importerExtRE = opts.loose
      ? /./
      : options.allowJs || basename(configPath).startsWith('jsconfig.')
      ? jsLikeRE
      : /\.[mc]?tsx?$/

    const resolutionCache = new Map<string, string>()

    return async (viteResolve, id, importer) => {
      // Ideally, Vite would normalize the importer path for us.
      importer = normalizePath(importer)

      // Remove query and hash parameters from the importer path.
      const importerFile = importer.replace(/[#?].+$/, '')

      // Ignore importers with unsupported extensions.
      if (!importerExtRE.test(importerFile)) {
        debugResolve('importer has unsupported extension. skipping...')
        return notApplicable
      }

      // Respect the include/exclude properties.
      const relativeImporterFile = relative(configDir, importerFile)
      if (!isIncludedRelative(relativeImporterFile)) {
        debugResolve('importer is not included. skipping...')
        return notApplicable
      }

      // Find and remove Vite's suffix (e.g. "?url") if present.
      // If the path is resolved, the suffix will be added back.
      const suffix = /\?.+$/.exec(id)?.[0]
      if (suffix) {
        id = id.slice(0, -suffix.length)
      }

      let resolvedId = resolutionCache.get(id)
      if (!resolvedId) {
        resolvedId = await resolveId(viteResolve, id, importer)
        if (!resolvedId) {
          return notFound
        }
        resolutionCache.set(id, resolvedId)
        if (debugResolve.enabled) {
          debugResolve('resolved without error:', {
            id,
            importer,
            resolvedId,
            configPath,
          })
        }
      }

      // Restore the suffix if one was removed earlier.
      if (suffix) {
        resolvedId += suffix
      }

      return [resolvedId, true]
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
  if (endsWithGlob) {
    this.push(compileGlob(relativeGlob))
  } else {
    // Append a globstar to possible directories.
    this.push(compileGlob(relativeGlob + '/**'))
    // Try to match specific files (must have file extension).
    if (/\.\w+$/.test(glob)) {
      this.push(compileGlob(relativeGlob))
    }
  }
}

function compileGlob(glob: string) {
  return globRex(glob, {
    extended: true,
    globstar: true,
  }).regex
}

function ensureRelative(dir: string, path: string) {
  return isAbsolute(path) ? relative(dir, path) : path
}
