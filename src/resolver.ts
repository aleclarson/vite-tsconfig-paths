import { readdir } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import { inspect } from 'node:util'
import { ResolverFactory } from 'oxc-resolver'
import * as vite from 'vite'
import { findAllProjects, loadProjectGraph } from './config'
import { debug } from './debug'
import { LogFileWriter } from './logFile'
import type { NormalizedPath } from './path'
import * as path from './path'
import { Directory, PluginOptions, Project, Resolver } from './types'

const notApplicable = [undefined, false] as const
const notFound = [undefined, true] as const

/** A directory with no projects. */
const emptyDirectory: Directory = {
  projects: Object.freeze([]) as any,
  lazyDiscovery: false,
}

type Logger = Pick<vite.Logger, 'error' | 'hasErrorLogged'>

export interface TsconfigResolvers {
  reset: () => void
  get: (importer: string) => AsyncIterable<Resolver>
  watch: (watcher: vite.FSWatcher) => void
}

interface ResolverStore {
  directoryCache: Map<string, Directory>
  resolversByProject: WeakMap<Project, Resolver>
  addedProjectPaths: Set<NormalizedPath>
}

export function createTsconfigResolvers({
  projectRoot,
  workspaceRoot,
  skip = () => false,
  logFile,
  logger,
  ...opts
}: Omit<PluginOptions, 'root' | 'logFile'> & {
  projectRoot: string
  workspaceRoot: string
  logFile?: LogFileWriter | null
  logger: Logger
}): TsconfigResolvers {
  let activeStore = createStore()
  let rebuildPromise: Promise<void> | undefined
  let requestedGeneration = 0
  let completedGeneration = 0
  let watcher: vite.FSWatcher | undefined
  const trackedSourcePaths = new Set<NormalizedPath>()
  let isFirstParseError = true

  const configNames = opts.configNames || ['tsconfig.json', 'jsconfig.json']
  debug(
    'Only tsconfig files with a name in this list are discoverable:',
    configNames
  )

  const parseProject = async (
    tsconfigFile: string
  ): Promise<Project | null> => {
    tsconfigFile = path.normalize(tsconfigFile)

    try {
      return loadProjectGraph(tsconfigFile)
    } catch (error: any) {
      if (opts.ignoreConfigErrors) {
        debug('[!] Failed to parse tsconfig file at %s', tsconfigFile)
        if (isFirstParseError) {
          debug('Remove the `ignoreConfigErrors` option to see the error.')
        }
      } else {
        logger.error(
          '[tsconfig-paths] An error occurred while parsing "' +
            tsconfigFile +
            '". See below for details.' +
            (isFirstParseError
              ? ' To disable this message, set the `ignoreConfigErrors` option to true.'
              : ''),
          { error }
        )
        if (!logger.hasErrorLogged(error)) {
          console.error(error)
        }
      }
      isFirstParseError = false
      return null
    }
  }

  function createStore(): ResolverStore {
    return {
      directoryCache: new Map(),
      resolversByProject: new WeakMap(),
      addedProjectPaths: new Set(),
    }
  }

  const trackSource = (sourcePath: string) => {
    const normalizedPath = path.normalize(sourcePath)
    if (trackedSourcePaths.has(normalizedPath)) {
      return
    }
    trackedSourcePaths.add(normalizedPath)
    watcher?.add(normalizedPath)
  }

  const addProject = (
    store: ResolverStore,
    project: Project,
    data?: Directory
  ) => {
    const tsconfigFile = project.tsconfigFile
    if (store.addedProjectPaths.has(tsconfigFile)) {
      return
    }
    store.addedProjectPaths.add(tsconfigFile)
    const dir = path.normalize(path.dirname(tsconfigFile))
    data ??= store.directoryCache.get(dir)

    // Sanity check
    if (data?.projects.some((p) => p.tsconfigFile === tsconfigFile)) {
      return
    }

    project.sourcePaths.forEach(trackSource)

    // Referenced projects must be added first, so they can override
    // the parent project's paths if both are in the same directory.
    if (project.referenced) {
      project.referenced.forEach((projectRef) => {
        addProject(store, projectRef)
      })
      // Ensure the latest directory data is used. One of the project
      // references may have updated it.
      data = store.directoryCache.get(dir)
    }

    const resolver = createResolver(project, opts, logFile)
    if (resolver) {
      store.resolversByProject.set(project, resolver)
    }

    if (!data || data === emptyDirectory) {
      store.directoryCache.set(
        dir,
        (data = {
          projects: [],
          lazyDiscovery: null,
        })
      )
    }

    data.projects.push(project)
  }

  const loadProject = async (
    store: ResolverStore,
    tsconfigFile: string,
    data?: Directory
  ) => {
    trackSource(tsconfigFile)
    const project = await parseProject(tsconfigFile)
    if (project) {
      addProject(store, project, data)
    }
  }

  // Ensure a deterministic order.
  const sortProjects = (projects: Project[]) => {
    projects.sort((left, right) =>
      left.tsconfigFile.localeCompare(right.tsconfigFile)
    )
  }

  const processConfigFile = async (
    store: ResolverStore,
    dir: NormalizedPath,
    name: string,
    data = store.directoryCache.get(dir)
  ): Promise<void> => {
    if (!data) {
      return // Wait to be loaded on-demand.
    }
    const file = path.join(dir, name as NormalizedPath)
    if (data.projects.some((p) => p.tsconfigFile === file)) {
      return
    }
    await loadProject(store, file, data)
  }

  const loadEagerProjects = async (store: ResolverStore) => {
    let projectPaths: string[]
    if (opts.projects) {
      projectPaths = opts.projects.map((file) => {
        if (!file.endsWith('.json')) {
          file = join(file, 'tsconfig.json')
        }
        return path.resolve(projectRoot, file)
      })
    } else {
      if (opts.projectDiscovery === 'lazy') {
        return
      }
      projectPaths = await findAllProjects(workspaceRoot, configNames, skip)
    }

    debug('Eagerly parsing these projects:', projectPaths)

    await Promise.all(
      Array.from(new Set(projectPaths), (p) => loadProject(store, p))
    )
    for (const data of store.directoryCache.values()) {
      sortProjects(data.projects)
    }
  }

  const resetResolvers = () => {
    requestedGeneration++
    if (!rebuildPromise) {
      rebuildPromise = rebuildResolvers().finally(() => {
        rebuildPromise = undefined
      })
    }
  }

  const rebuildResolvers = async () => {
    while (completedGeneration < requestedGeneration) {
      const generation = requestedGeneration
      const store = createStore()
      await loadEagerProjects(store)
      activeStore = store
      completedGeneration = generation
    }
  }

  // Only used when projectDiscovery is 'lazy'.
  const discoverProjects = async (
    store: ResolverStore,
    dir: NormalizedPath,
    data: Directory
  ) => {
    debug('Searching directory for tsconfig files:', dir)
    const names = await readdir(dir).catch(() => [])

    await Promise.all(
      names
        .filter((name) => configNames.includes(name))
        .map((name) => {
          return processConfigFile(store, dir, name, data)
        })
    )

    if (data.projects.length) {
      sortProjects(data.projects)
      if (debug.enabled) {
        debug(
          `Directory "${dir}" contains the following tsconfig files:`,
          data.projects.map((p) => path.basename(p.tsconfigFile))
        )
      }
    } else {
      // No projects found. Reduce memory usage with a stand-in.
      store.directoryCache.set(dir, emptyDirectory)
      debug('No tsconfig files found in directory:', dir)
    }
  }

  const getResolvers = async function* (
    importer: string
  ): AsyncIterable<Resolver> {
    while (true) {
      await rebuildPromise
      const store = activeStore
      const resolvers: Resolver[] = []
      let dir = path.normalize(importer)
      const { root } = path.parse(dir)
      while (dir !== (dir = path.dirname(dir)) && dir !== root) {
        let data = store.directoryCache.get(dir)

        if (opts.projectDiscovery === 'lazy') {
          if (!data) {
            if (skip(path.basename(dir))) {
              store.directoryCache.set(dir, emptyDirectory)
              continue
            }
            store.directoryCache.set(
              dir,
              (data = {
                projects: [],
                lazyDiscovery: null,
              })
            )
          }
          await (data.lazyDiscovery ??= discoverProjects(store, dir, data))
        } else if (!data) {
          continue
        }

        for (const project of data.projects) {
          const resolver = store.resolversByProject.get(project)
          if (resolver) {
            resolvers.push(resolver)
          }
        }
      }

      // A watcher event may arrive while lazy discovery is awaiting I/O.
      // Retry against the replacement store instead of yielding stale data.
      if (store !== activeStore || rebuildPromise) {
        continue
      }
      yield* resolvers
      return
    }
  }

  const watchProjects = (nextWatcher: vite.FSWatcher) => {
    watcher = nextWatcher
    trackedSourcePaths.forEach((sourcePath) => watcher!.add(sourcePath))
    watcher.on('all', (event, file) => {
      const normalizedFile = path.normalize(file)
      if (!path.isAbsolute(normalizedFile)) {
        return
      }
      if (
        (event === 'add' &&
          (configNames.includes(path.basename(normalizedFile)) ||
            trackedSourcePaths.has(normalizedFile))) ||
        ((event === 'change' || event === 'unlink') &&
          trackedSourcePaths.has(normalizedFile))
      ) {
        debug(`Rebuilding resolver graph because of ${event} event:`, file)
        resetResolvers()
      }
    })
  }

  return {
    reset: resetResolvers,
    get: getResolvers,
    watch: watchProjects,
  }
}

type ResolverOptions = {
  loose?: boolean
  importerFilter?: (importer: string) => boolean
}

function createResolver(
  project: Project,
  opts: ResolverOptions,
  logFile?: LogFileWriter | null
): Resolver | null {
  const configPath = project.tsconfigFile
  const config = project.tsconfig

  if (debug.enabled) {
    debug('Config loaded:', inspect({ configPath, config }, false, 10, true))
  }

  // Sometimes a tsconfig is not meant to be used for path resolution,
  // but rather for pointing to other tsconfig files and possibly being
  // extended by them. This is represented by an explicitly empty "files"
  // array and a missing/empty "include" array.
  if (config.files?.length == 0 && !config.include?.length) {
    debug(
      `[!] Skipping "${configPath}" as no files can be matched since "files" is empty and "include" is missing or empty.`
    )
    return null
  }

  const compilerOptions = config.compilerOptions || {}
  const { baseUrl, paths } = compilerOptions

  if (!paths && !baseUrl) {
    debug(`[!] Skipping "${configPath}" as no paths or baseUrl are defined.`)
    return null
  }

  // Create an oxc-resolver instance for this project's tsconfig.
  // Using modules: [] prevents node_modules resolution — we only want
  // tsconfig paths and baseUrl resolution.
  const oxcResolver = new ResolverFactory({
    tsconfig: { configFile: configPath },
    extensions: [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.mts',
      '.mjs',
      '.cts',
      '.cjs',
      '.vue',
      '.svelte',
      '.astro',
      '.mdx',
      '.json',
    ],
    mainFiles: ['index'],
    modules: [],
    symlinks: true,
  })

  const configDir = path.normalize(path.dirname(configPath))

  let outDir = compilerOptions.outDir && path.normalize(compilerOptions.outDir)

  // `${configDir}` may produce an absolute outDir, while `getIncluder`
  // expects paths relative to the config directory.
  if (outDir && path.isAbsolute(outDir)) {
    outDir = path.relative(configDir, outDir)
  }

  const isIncludedRelative = getIncluder(
    config.include?.map((p) => ensureRelative(configDir, p)),
    config.exclude?.map((p) => ensureRelative(configDir, p)),
    outDir
  )

  const isImporterSupported = opts.loose
    ? () => true
    : (opts.importerFilter ??
      (() => {
        const extensionFilter =
          compilerOptions.allowJs ||
          path.basename(configPath).startsWith('jsconfig.')
            ? /\.(astro|mdx|svelte|vue|[mc]?[jt]sx?)$/
            : /\.[mc]?tsx?$/

        return (importer: string) => extensionFilter.test(importer)
      })())

  const resolutionCache = new Map<string, string>()
  const inflightResolutions = new Map<string, Promise<string | undefined>>()

  const hashQueryPattern = /[#?].+$/
  const queryPattern = /\?.+$/
  const dtsPattern = /\.d\.ts(\?|$)/

  return async (id, importer) => {
    // Remove query and hash parameters from the importer path.
    const importerFile = path.normalize(importer.replace(hashQueryPattern, ''))

    // Skip unsupported importers.
    if (!isImporterSupported(importerFile)) {
      logFile?.write('unsupportedExtension', { importer, id })
      return notApplicable
    }

    // Respect the include/exclude properties.
    const relativeImporterFile = path.relative(configDir, importerFile)
    if (!isIncludedRelative(relativeImporterFile)) {
      logFile?.write('configMismatch', { importer, id, configPath })
      return notApplicable
    }

    // Find and remove special Vite queries (e.g. "?url") if present. If
    // the path is resolved, the query will be added back.
    const query = queryPattern.exec(id)?.[0]
    if (query) {
      id = id.slice(0, -query.length)
    }

    // `oxcResolver.async` takes the importer's directory, and the result can
    // depend on it: a `#`-subpath import resolves against the nearest
    // package.json, `exports`/`imports` and symlinks are package-relative,
    // etc. This resolver instance is shared by every importer under the
    // tsconfig, so a cache keyed on `id` alone lets the first importer to
    // resolve a specifier poison the result for all the others. Key on the
    // directory too. The \0 byte can't appear in a path or a bare
    // specifier, so it is a safe separator.
    const importerDir = path.dirname(importerFile)
    const cacheKey = importerDir + '\0' + id

    let resolvedId = resolutionCache.get(cacheKey)
    if (resolvedId) {
      logFile?.write('resolvedFromCache', {
        importer,
        id,
        resolvedId,
        configPath,
      })
    } else {
      // Coalesce concurrent resolutions for the same specifier to avoid
      // duplicate native calls during parallel pre-bundling.
      let inflight = inflightResolutions.get(cacheKey)
      if (!inflight) {
        inflight = (async () => {
          const result = await oxcResolver.async(importerDir, id)
          if (result.path) {
            const resolved = path.normalize(result.path)
            // Skip .json resolutions unless explicitly imported (prevents
            // accidental resolution to .json via baseUrl).
            if (resolved.endsWith('.json') && !id.endsWith('.json')) {
              return undefined
            }
            return resolved
          }
          return undefined
        })()
        inflightResolutions.set(cacheKey, inflight)
      }

      try {
        resolvedId = await inflight
      } finally {
        inflightResolutions.delete(cacheKey)
      }

      if (!resolvedId) {
        logFile?.write('notFound', { importer, id, configPath })
        return notFound
      }

      logFile?.write('resolved', {
        importer,
        id,
        resolvedId,
        configPath,
      })
      resolutionCache.set(cacheKey, resolvedId)
    }

    // If we get a .d.ts file that wasn't explicitly imported, it's because
    // a tsconfig file is being used for opt-in type overrides. Skip these
    // implicit .d.ts resolutions to avoid trouble, but allow explicit ones
    // like `import "@common/global.d.ts"`.
    if (dtsPattern.test(resolvedId) && !dtsPattern.test(id)) {
      logFile?.write('resolvedToDeclarationFile', {
        importer,
        id,
        resolvedId,
        configPath,
      })
      return notApplicable
    }

    // Restore the query if one was removed earlier.
    if (query) {
      resolvedId += query
    }

    return [resolvedId, true]
  }
}

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

    if (debug.enabled) {
      debug(`Compiled tsconfig globs:`, {
        include: {
          globs: includePaths,
          regexes: includers,
        },
        exclude: {
          globs: excludePaths,
          regexes: excluders,
        },
      })
    }

    return (id: string) => {
      id = id.replace(/\?.+$/, '')
      if (!path.relativeImportRE.test(id)) {
        id = './' + id
      }
      const test = (glob: RegExp) => glob.test(id)
      return includers.some(test) && !excluders.some(test)
    }
  }
  return () => true
}

function addCompiledGlob(this: RegExp[], glob: string) {
  const endsWithGlob = glob.split('/').pop()!.includes('*')
  const relativeGlob = path.relativeImportRE.test(glob) ? glob : './' + glob
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

function compileGlob(glob: string): RegExp {
  // Normalize consecutive slashes (e.g. "./" + "/**" → ".//***" → "./**")
  glob = glob.replace(/\/{2,}/g, '/')
  let result = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          result += '(?:.+/)?'
          i += 2
        } else {
          result += '.*'
          i += 1
        }
      } else {
        result += '[^/]*'
      }
    } else if (char === '?') {
      result += '[^/]'
    } else if ('.+^${}()|[]\\'.includes(char)) {
      result += '\\' + char
    } else {
      result += char
    }
  }
  return new RegExp('^' + result + '$')
}

function ensureRelative(dir: string, path: string) {
  return isAbsolute(path) ? relative(dir, path) : path
}
