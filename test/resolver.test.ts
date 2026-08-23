import { EventEmitter } from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { normalize } from '../src/path'
import { createTsconfigResolvers } from '../src/resolver'

test.each([
  ['allowJs', { allowJs: true }, {}, 'index.js'],
  ['loose', {}, { loose: true }, 'Component.vue'],
  [
    'importerFilter',
    {},
    { importerFilter: (file: string) => file.endsWith('.custom') },
    'index.custom',
  ],
])(
  'resolves from supported %s importers',
  async (_, compilerOptions, options, importer) => {
    const root = createProject(compilerOptions)
    const resolvers = createTsconfigResolvers({
      ...options,
      projects: ['tsconfig.json'],
      projectRoot: root,
      workspaceRoot: root,
      logger: { error() {}, hasErrorLogged: () => false },
    })
    resolvers.reset()

    const [resolveId] = await collect(
      resolvers.get(join(root, 'src', importer))
    )

    await expect(
      resolveId('@/value', join(root, 'src', importer))
    ).resolves.toEqual([
      normalize(realpathSync(join(root, 'src/value.ts'))),
      true,
    ])
  }
)

test('keeps include and exclude matching plugin-owned', async () => {
  const root = createProject(
    {},
    { include: ['src'], exclude: ['src/excluded'] }
  )
  const resolvers = createTsconfigResolvers({
    projects: ['tsconfig.json'],
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  resolvers.reset()

  const included = join(root, 'src/index.ts')
  const excluded = join(root, 'src/excluded/index.ts')
  const [resolveId] = await collect(resolvers.get(included))

  await expect(resolveId('@/value', included)).resolves.toEqual([
    normalize(realpathSync(join(root, 'src/value.ts'))),
    true,
  ])
  await expect(resolveId('@/value', excluded)).resolves.toEqual([
    undefined,
    false,
  ])
})

test.each([
  ['eager', { configNames: ['tsconfig.paths.json'] }],
  [
    'lazy',
    { configNames: ['tsconfig.paths.json'], projectDiscovery: 'lazy' as const },
  ],
  ['explicit projects', { projects: ['.'] }],
])('supports %s discovery', async (_, options) => {
  const configName =
    'configNames' in options ? options.configNames[0] : 'tsconfig.json'
  const root = createProject({}, {}, configName)
  const resolvers = createTsconfigResolvers({
    ...options,
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  resolvers.reset()

  const importer = join(root, 'src/index.ts')
  const [resolveId] = await collect(resolvers.get(importer))

  await expect(resolveId('@/value', importer)).resolves.toEqual([
    normalize(realpathSync(join(root, 'src/value.ts'))),
    true,
  ])
})

test('uses config path order for deterministic precedence', async () => {
  const root = createProject({}, {}, 'z.json')
  write(
    root,
    'a.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./first/*'] } } })
  )
  write(root, 'first/value.ts', 'export const value = true')
  const resolvers = createTsconfigResolvers({
    configNames: ['z.json', 'a.json'],
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  resolvers.reset()

  const importer = join(root, 'src/index.ts')
  const [resolveId] = await collect(resolvers.get(importer))

  await expect(resolveId('@/value', importer)).resolves.toEqual([
    normalize(realpathSync(join(root, 'first/value.ts'))),
    true,
  ])
})

test('reloads a directly changed, unlinked, and restored config', async () => {
  const root = createProject({}, {})
  write(root, 'next/value.ts', 'export const value = true')
  const resolvers = createTsconfigResolvers({
    projects: ['tsconfig.json'],
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  const watcher = createWatcher()
  resolvers.reset()
  resolvers.watch(watcher as any)

  const importer = join(root, 'src/index.ts')
  await collect(resolvers.get(importer))
  write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./next/*'] } } })
  )
  watcher.emit('all', 'change', join(root, 'tsconfig.json'))

  await expectResolution(resolvers, importer, join(root, 'next/value.ts'))

  unlinkSync(join(root, 'tsconfig.json'))
  watcher.emit('all', 'unlink', join(root, 'tsconfig.json'))
  expect(await collect(resolvers.get(importer))).toEqual([])

  write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
  )
  watcher.emit('all', 'add', join(root, 'tsconfig.json'))
  await expectResolution(resolvers, importer, join(root, 'src/value.ts'))
})

test('watches sources loaded before the watcher is attached', async () => {
  const root = createProject(
    {},
    { extends: './base.json', references: [{ path: './referenced' }] }
  )
  write(root, 'base.json', JSON.stringify({ compilerOptions: {} }))
  write(
    root,
    'referenced/tsconfig.json',
    JSON.stringify({ compilerOptions: {} })
  )
  const resolvers = createTsconfigResolvers({
    projects: ['tsconfig.json'],
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  resolvers.reset()
  await collect(resolvers.get(join(root, 'src/index.ts')))

  const watcher = createWatcher()
  resolvers.watch(watcher as any)

  expect(watcher.add).toHaveBeenCalledWith(
    normalize(join(root, 'tsconfig.json'))
  )
  expect(watcher.add).toHaveBeenCalledWith(normalize(join(root, 'base.json')))
  expect(watcher.add).toHaveBeenCalledWith(
    normalize(join(root, 'referenced/tsconfig.json'))
  )
})

test('rebuilds for transitive source changes and restores an unlinked source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-resolver-'))
  write(
    root,
    'tsconfig.json',
    JSON.stringify({ extends: './intermediate.json' })
  )
  write(root, 'intermediate.json', JSON.stringify({ extends: './base.json' }))
  write(root, 'src/value.ts', 'export const value = true')
  write(
    root,
    'base.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
  )
  write(root, 'next/value.ts', 'export const value = true')
  const resolvers = createTsconfigResolvers({
    projects: ['tsconfig.json'],
    projectRoot: root,
    workspaceRoot: root,
    ignoreConfigErrors: true,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  const watcher = createWatcher()
  resolvers.reset()
  resolvers.watch(watcher as any)
  const importer = join(root, 'src/index.ts')
  await expectResolution(resolvers, importer, join(root, 'src/value.ts'))

  write(
    root,
    'base.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./next/*'] } } })
  )
  watcher.emit('all', 'change', join(root, 'base.json'))
  await expectResolution(resolvers, importer, join(root, 'next/value.ts'))

  unlinkSync(join(root, 'base.json'))
  watcher.emit('all', 'unlink', join(root, 'base.json'))
  expect(await collect(resolvers.get(importer))).toEqual([])

  write(
    root,
    'base.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
  )
  watcher.emit('all', 'add', join(root, 'base.json'))
  await expectResolution(resolvers, importer, join(root, 'src/value.ts'))
})

test.each(['eager', 'lazy'] as const)(
  'discovers a config added after an empty %s scan',
  async (discovery) => {
    const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-resolver-'))
    write(root, 'src/value.ts', 'export const value = true')
    const resolvers = createTsconfigResolvers({
      projectDiscovery: discovery === 'lazy' ? 'lazy' : 'eager',
      projectRoot: root,
      workspaceRoot: root,
      logger: { error() {}, hasErrorLogged: () => false },
    })
    const watcher = createWatcher()
    resolvers.reset()
    resolvers.watch(watcher as any)
    const importer = join(root, 'src/index.ts')
    expect(await collect(resolvers.get(importer))).toEqual([])

    write(
      root,
      'tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
    )
    watcher.emit('all', 'add', join(root, 'tsconfig.json'))

    await expectResolution(resolvers, importer, join(root, 'src/value.ts'))
  }
)

test('coalesces burst events and publishes only the latest graph', async () => {
  const root = createProject({}, {})
  write(root, 'first/value.ts', 'export const value = true')
  write(root, 'last/value.ts', 'export const value = true')
  const resolvers = createTsconfigResolvers({
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  const watcher = createWatcher()
  resolvers.reset()
  resolvers.watch(watcher as any)
  const importer = join(root, 'src/index.ts')
  await expectResolution(resolvers, importer, join(root, 'src/value.ts'))

  write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./first/*'] } } })
  )
  watcher.emit('all', 'change', join(root, 'tsconfig.json'))
  write(
    root,
    'tsconfig.json',
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./last/*'] } } })
  )
  watcher.emit('all', 'change', join(root, 'tsconfig.json'))

  await expectResolution(resolvers, importer, join(root, 'last/value.ts'))
})

function createProject(
  compilerOptions: Record<string, unknown>,
  config: Record<string, unknown> = {},
  configName = 'tsconfig.json'
) {
  const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-resolver-'))
  write(
    root,
    configName,
    JSON.stringify({
      ...config,
      compilerOptions: {
        ...compilerOptions,
        paths: { '@/*': ['./src/*'] },
      },
    })
  )
  write(root, 'src/value.ts', 'export const value = true')
  return root
}

function write(root: string, file: string, contents: string) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const values: T[] = []
  for await (const value of iterable) {
    values.push(value)
  }
  return values
}

function createWatcher() {
  return Object.assign(new EventEmitter(), { add: vi.fn() })
}

async function expectResolution(
  resolvers: ReturnType<typeof createTsconfigResolvers>,
  importer: string,
  expected: string
) {
  const [resolveId] = await collect(resolvers.get(importer))
  await expect(resolveId('@/value', importer)).resolves.toEqual([
    normalize(realpathSync(expected)),
    true,
  ])
}
