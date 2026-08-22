import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
    ).resolves.toEqual([realpathSync(join(root, 'src/value.ts')), true])
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
    realpathSync(join(root, 'src/value.ts')),
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
    realpathSync(join(root, 'src/value.ts')),
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
    realpathSync(join(root, 'first/value.ts')),
    true,
  ])
})

test('reloads a directly changed config', async () => {
  const root = createProject({}, {})
  write(root, 'next/value.ts', 'export const value = true')
  const resolvers = createTsconfigResolvers({
    projects: ['tsconfig.json'],
    projectRoot: root,
    workspaceRoot: root,
    logger: { error() {}, hasErrorLogged: () => false },
  })
  const watcher = Object.assign(new EventEmitter(), { add() {} })
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

  await vi.waitFor(async () => {
    const [resolveId] = await collect(resolvers.get(importer))
    await expect(resolveId('@/value', importer)).resolves.toEqual([
      realpathSync(join(root, 'next/value.ts')),
      true,
    ])
  })
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
