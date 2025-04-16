import * as fs from 'fs'
import { readdir } from 'fs/promises'
import globRex from 'globrex'
import { isAbsolute, join, relative } from 'path'
import { inspect } from 'util'
import { ViteDevServer, Plugin, searchForWorkspaceRoot } from 'vite'
import { debug, debugResolve } from './debug'
import { resolvePathMappings } from './mappings'
import type { NormalizedPath } from './path'
import * as path from './path'
import {
  Directory,
  PluginOptions,
  Project,
  Resolver,
  ViteResolve,
} from './types'

const notApplicable = [undefined, false] as const
const notFound = [undefined, true] as const

/** A directory with no projects. */
const emptyDirectory: Directory = {
  projects: Object.freeze([]) as any,
  lazyDiscovery: false,
}

export type { PluginOptions }

export default (opts: PluginOptions = {}): Plugin => {
  let processConfigFile: (dir: NormalizedPath, name: string) => Promise<void>
  let invalidateConfigFile: (
    dir: NormalizedPath,
    name: string,
    event: 'change' | 'unlink'
  ) => void
  let getResolvers: (importer: string) => AsyncIterable<Resolver>
  let viteDevServer: ViteDevServer | undefined

  const directoryCache = new Map<string, Directory>()
  const resolversByProject = new WeakMap<Project, Resolver>()
  const watchedProjectPaths = new Set<string>()

  return {
    name: 'vite-tsconfig-paths',
    enforce: 'pre',
    async configResolved(config) {
      let projectRoot: NormalizedPath
      let workspaceRoot: NormalizedPath

      let { root } = opts
      if (root) {
        root = projectRoot = workspaceRoot = path.resolve(config.root, root)
        debug('Forced root:', root)
      } else {
        projectRoot = path.normalize(config.root)
        workspaceRoot = path.normalize(searchForWorkspaceRoot(config.root))
        debug('Project root:  ', projectRoot)
        debug('Workspace root:', workspaceRoot)
      }

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

      // tsconfck is ESM only, so import(…) is needed for CommonJS support.
      const tsconfck = await import('tsconfck')

      const configNames = opts.configNames || ['tsconfig.json', 'jsconfig.json']

      let isFirstParseError = true

      const parseProject = (tsconfigFile: string): Promise<Project | null> => {
        tsconfigFile = path.normalize(tsconfigFile)

        const projectPromise = (
          hasTypeScriptDep
            ? tsconfck.parseNative(tsconfigFile)
            : tsconfck.parse(tsconfigFile)
        ) as Promise<Project>

        return projectPromise.catch((error) => {
          if (opts.ignoreConfigErrors) {
            debug('Failed to parse tsconfig file at %s', tsconfigFile)
            if (isFirstParseError) {
              debug('Remove the `ignoreConfigErrors` option to see the error.')
            }
          } else {
            config.logger.error(
              '[tsconfig-paths] An error occurred while parsing "' +
                tsconfigFile +
                '". See below for details.' +
                (isFirstParseError
                  ? ' To disable this message, set the `ignoreConfigErrors` option to true.'
                  : ''),
              { error }
            )
            if (!config.logger.hasErrorLogged(error)) {
              console.error(error)
            }
          }
          isFirstParseError = false
          return null
        })
      }

      const watchProjectPath = (projectPath: string) => {
        if (watchedProjectPaths.has(projectPath)) {
          return false
        }
        watchedProjectPaths.add(projectPath)
        viteDevServer?.watcher.add(projectPath)
        return true
      }

      const addProject = (project: Project, data?: Directory) => {
        if (!watchProjectPath(project.tsconfigFile)) {
          return
        }

        project.extended?.forEach((projectParent) => {
          watchProjectPath(projectParent.tsconfigFile)
        })

        // Referenced projects must be added first, so they can override
        // the parent project's paths if both are in the same directory.
        project.referenced?.forEach((projectRef) => {
          addProject(projectRef)
        })

        const resolver = createResolver(project)
        if (resolver) {
          resolversByProject.set(project, resolver)
        }

        if (!data) {
          const dir = path.dirname(project.tsconfigFile)
          data = directoryCache.get(dir)
          if (!data || data === emptyDirectory) {
            directoryCache.set(
              dir,
              (data = {
                projects: [],
                lazyDiscovery: null,
              })
            )
          }
        }

        data.projects.push(project)
      }

      processConfigFile = async (dir, name) => {
        if (!configNames.includes(name)) {
          return
        }
        const data = directoryCache.get(dir)
        if (!data) {
          return // Wait to be loaded on-demand.
        }
        const tsconfigFile = path.join(dir, name as NormalizedPath)
        if (data.projects.some((p) => p.tsconfigFile === tsconfigFile)) {
          return
        }
        await loadProject(tsconfigFile, data)
      }

      invalidateConfigFile = (dir, name, event) => {
        const data = directoryCache.get(dir)
        if (!data) {
          return
        }
        const file = path.join(dir, name as NormalizedPath)
        const index = data.projects.findIndex(
          (project) => project.tsconfigFile === file
        )
        if (index !== -1) {
          resolversByProject.delete(data.projects[index])
          data.projects.splice(index, 1)
          if (event === 'change') {
            data.lazyDiscovery = null
          }
        }
      }

      const shouldSkipDir = (dir: string) => {
        if (dir === '.git' || dir === 'node_modules') {
          return true
        }
        if (typeof opts.skip === 'function') {
          return opts.skip(dir)
        }
        return false
      }

      if (opts.projects || opts.projectDiscovery !== 'lazy') {
        const projectPaths =
          opts.projects?.map((file) => {
            if (!file.endsWith('.json')) {
              file = join(file, 'tsconfig.json')
            }
            return path.resolve(projectRoot, file)
          }) ??
          (await tsconfck.findAll(workspaceRoot, {
            configNames,
            skip: shouldSkipDir,
          }))

        debug('Eagerly parsing these projects:', projectPaths)

        for (const project of new Set(
          await Promise.all(projectPaths.map(parseProject))
        )) {
          if (project) {
            addProject(project)
          }
        }
      }

      // Only used when projectDiscovery is 'lazy'.
      const discoverProjects = async (dir: NormalizedPath, data: Directory) => {
        const names = await readdir(dir).catch(() => [])
        await Promise.all(names.map((name) => processConfigFile(dir, name)))

        if (data.projects.length) {
          // Ensure a deterministic order.
          data.projects.sort((left, right) =>
            left.tsconfigFile.localeCompare(right.tsconfigFile)
          )
        } else {
          // No projects found. Reduce memory usage with a stand-in.
          directoryCache.set(dir, emptyDirectory)
        }
      }

      getResolvers = async function* (importer) {
        let dir = path.normalize(importer)

        const { root } = path.parse(dir)

        while (dir !== (dir = path.dirname(dir)) && dir !== root) {
          let data = directoryCache.get(dir)

          if (opts.projectDiscovery === 'lazy') {
            if (!data) {
              if (shouldSkipDir(path.basename(dir))) {
                directoryCache.set(dir, emptyDirectory)
                continue
              }
              directoryCache.set(
                dir,
                (data = {
                  projects: [],
                  lazyDiscovery: null,
                })
              )
            }
            await (data.lazyDiscovery ??= discoverProjects(dir, data))
          } else if (!data) {
            continue
          }

          for (const project of data.projects) {
            const resolver = resolversByProject.get(project)
            if (resolver) {
              yield resolver
            }
          }
        }
      }
    },
    configureServer(server) {
      viteDevServer = server

      if (opts.projectDiscovery === 'lazy') {
        server.watcher.on('all', (event, file) => {
          const normalizedFile = path.normalize(file)
          if (
            !path.isAbsolute(normalizedFile) ||
            !watchedProjectPaths.has(normalizedFile)
          ) {
            return
          }
          if (event === 'add') {
            processConfigFile(
              path.dirname(normalizedFile),
              path.basename(normalizedFile)
            )
          } else if (event === 'change' || event === 'unlink') {
            invalidateConfigFile(
              path.dirname(normalizedFile),
              path.basename(normalizedFile),
              event
            )
          }
        })
      }
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
      if (path.isAbsolute(id)) {
        debugResolve('id is an absolute path. skipping...')
        return
      }
      if (id.includes('\0')) {
        debugResolve('id is a virtual module. skipping...')
        return
      }

      // Attempt to coerce the importer to a file path. The importer may be
      // a "virtual module" that may not exist in the filesystem, or it may
      // be derived from a real file.
      let importerFile = importer
      if (importer[0] === '\0') {
        // Check if the real file path is provided in the query string. For
        // example, the WXT framework for browser extensions does this.
        const index = importer.indexOf('?')
        if (index !== -1) {
          const query = path.normalize(importer.slice(index + 1))
          if (path.isAbsolute(query) && fs.existsSync(query)) {
            importerFile = query
          }
        }
      }

      // For Vite 4 and under, skipSelf needs to be set.
      const resolveOptions = { ...options, skipSelf: true }
      const viteResolve: ViteResolve = async (id, importer) =>
        (await this.resolve(id, importer, resolveOptions))?.id

      for await (const resolveId of getResolvers(importerFile)) {
        const [resolved, matched] = await resolveId(viteResolve, id, importer)
        if (resolved) {
          return resolved
        }
        if (matched) {
          // Once a matching resolver is found, stop looking.
          break
        }
      }
    },
  }

  function resolvePathsRootDir(project: Project): string {
    if (project.result) {
      const { options } = project.result
      if (options && typeof options.pathsBasePath === 'string') {
        return options.pathsBasePath
      }
      return path.dirname(project.tsconfigFile)
    }
    const baseUrl = project.tsconfig.compilerOptions?.baseUrl
    if (baseUrl) {
      return baseUrl
    }
    const projectWithPaths = project.extended?.find(
      (project) => project.tsconfig.compilerOptions?.paths
    )
    return path.dirname((projectWithPaths ?? project).tsconfigFile)
  }

  function createResolver(project: Project): Resolver | null {
    const configPath = project.tsconfigFile
    const config = project.tsconfig

    debug('config loaded:', inspect({ configPath, config }, false, 10, true))

    // Sometimes a tsconfig is not meant to be used for path resolution,
    // but rather for pointing to other tsconfig files and possibly being
    // extended by them. This is represented by an explicitly empty "files"
    // array and a missing/empty "include" array.
    if (config.files?.length == 0 && !config.include?.length) {
      debug(
        `[!] skipping "${configPath}" as no files can be matched since "files" is empty and "include" is missing or empty`
      )
      return null
    }

    const compilerOptions = config.compilerOptions || {}
    const { baseUrl, paths } = compilerOptions
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
              // the match pattern. In that case, we reuse the final glob
              // match.
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

    const configDir = path.dirname(configPath)

    let outDir =
      compilerOptions.outDir && path.normalize(compilerOptions.outDir)

    // When `tsconfck.parseNative` is used, the outDir is absolute, which
    // is not what `getIncluder` expects.
    if (outDir && path.isAbsolute(outDir)) {
      outDir = path.relative(configDir, outDir)
    }

    const isIncludedRelative = getIncluder(
      config.include?.map((p) => ensureRelative(configDir, p)),
      config.exclude?.map((p) => ensureRelative(configDir, p)),
      outDir
    )

    const importerExtRE = opts.loose
      ? /./
      : compilerOptions.allowJs ||
        path.basename(configPath).startsWith('jsconfig.')
      ? jsLikeRE
      : /\.[mc]?tsx?$/

    const resolutionCache = new Map<string, string>()

    return async (viteResolve, id, importer) => {
      // Remove query and hash parameters from the importer path.
      const importerFile = path.normalize(importer.replace(/[#?].+$/, ''))

      // Ignore importers with unsupported extensions.
      if (!importerExtRE.test(importerFile)) {
        debugResolve('importer has unsupported extension. skipping...')
        return notApplicable
      }

      // Respect the include/exclude properties.
      const relativeImporterFile = path.relative(configDir, importerFile)
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
