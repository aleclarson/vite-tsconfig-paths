import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import ts from 'typescript'
import { createServer } from 'vite'
import tsconfigPaths from '../src/index'
import { normalize } from '../src/path'
import { createTsconfigResolvers } from '../src/resolver'

type Case = {
  name: string
  compilerOptions?: Record<string, unknown>
  files: string[]
  id: string
  expected: string
  importer?: string
  configName?: string
}

const cases: Case[] = [
  {
    name: 'exact aliases beat wildcard aliases',
    compilerOptions: {
      paths: { '@/*': ['./src/*'], '@/value': ['./exact.ts'] },
    },
    files: ['src/value.ts', 'exact.ts'],
    id: '@/value',
    expected: 'exact.ts',
  },
  {
    name: 'the longest wildcard prefix wins',
    compilerOptions: {
      paths: { '@/*': ['./src/*'], '@/utils/*': ['./utils/*'] },
    },
    files: ['src/utils/value.ts', 'utils/value.ts'],
    id: '@/utils/value',
    expected: 'utils/value.ts',
  },
  {
    name: 'a missing first alias target falls back to the second',
    compilerOptions: { paths: { '@/*': ['./missing/*', './src/*'] } },
    files: ['src/value.ts'],
    id: '@/value',
    expected: 'src/value.ts',
  },
  {
    name: 'the first existing alias target wins',
    compilerOptions: { paths: { '@/*': ['./first/*', './src/*'] } },
    files: ['first/value.ts', 'src/value.ts'],
    id: '@/value',
    expected: 'first/value.ts',
  },
  {
    name: 'baseUrl works without paths and precedes node_modules',
    compilerOptions: { baseUrl: './src', paths: undefined },
    files: ['src/value.ts', 'node_modules/value/index.js'],
    id: 'value',
    expected: 'src/value.ts',
  },
  {
    name: 'paths precede baseUrl',
    compilerOptions: { baseUrl: '.', paths: { value: ['./src/value.ts'] } },
    files: ['value.ts', 'src/value.ts'],
    id: 'value',
    expected: 'src/value.ts',
  },
  {
    name: 'missing baseUrl targets fall through to package resolution',
    compilerOptions: { baseUrl: './src', paths: undefined },
    files: ['node_modules/value/index.js'],
    id: 'value',
    expected: 'node_modules/value/index.js',
  },
  {
    name: 'aliases resolve directory indexes',
    files: ['src/value/index.ts'],
    id: '@/value',
    expected: 'src/value/index.ts',
  },
  {
    name: 'aliases resolve TSX components from TSX importers',
    files: ['src/value.tsx'],
    importer: 'src/index.tsx',
    id: '@/value',
    expected: 'src/value.tsx',
  },
  {
    name: 'aliases resolve explicit JSON imports',
    files: ['src/value.json'],
    id: '@/value.json',
    expected: 'src/value.json',
  },
  {
    name: 'allowJs enables JavaScript importers',
    compilerOptions: { allowJs: true },
    files: ['src/value.ts'],
    importer: 'src/index.js',
    id: '@/value',
    expected: 'src/value.ts',
  },
  {
    name: 'jsconfig enables JavaScript importers without explicit allowJs',
    configName: 'jsconfig.json',
    files: ['src/value.ts'],
    importer: 'src/index.js',
    id: '@/value',
    expected: 'src/value.ts',
  },
]

test.each(cases)('$name matches TypeScript', async (fixture) => {
  const root = makeRoot()
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    const configName = fixture.configName ?? 'tsconfig.json'
    writeConfig(root, configName, fixture.compilerOptions)
    for (const file of fixture.files) {
      write(
        root,
        file,
        file.endsWith('.json') ? '{}' : 'export const value = true'
      )
    }
    const importer = join(root, fixture.importer ?? 'src/index.ts')
    write(root, fixture.importer ?? 'src/index.ts', 'export {}')
    const config = parseConfig(join(root, configName))
    expect(config.fileNames.map(normalize)).toContain(normalize(importer))
    const expected = normalize(realpathSync(join(root, fixture.expected)))
    expect(resolveTypescript(fixture.id, importer, config)).toBe(expected)

    // Use the whole Vite chain so normal package fallback is exercised too.
    server = await startServer(root)
    const result = await server.pluginContainer.resolveId(fixture.id, importer)
    expect(result?.id).toBe(expected)
  } finally {
    await server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(['eager', 'lazy'] as const)(
  'nested projects match their TypeScript configs with %s discovery',
  async (projectDiscovery) => {
    const root = makeRoot()
    let server: Awaited<ReturnType<typeof createServer>> | undefined
    try {
      writeConfig(root, 'tsconfig.json')
      write(root, 'src/value.ts', 'export const value = "root"')
      write(root, 'src/parentOnly.ts', 'export {}')
      for (const name of ['a', 'b']) {
        writeConfig(
          root,
          `packages/${name}/tsconfig.json`,
          {},
          {
            exclude: ['src/excluded.ts'],
          }
        )
        write(root, `packages/${name}/src/index.ts`, 'export {}')
        write(root, `packages/${name}/src/excluded.ts`, 'export {}')
        write(
          root,
          `packages/${name}/src/value.ts`,
          `export const value = "${name}"`
        )
      }
      server = await startServer(root, projectDiscovery)
      for (const name of ['a', 'b']) {
        const importer = join(root, `packages/${name}/src/index.ts`)
        const config = parseConfig(join(root, `packages/${name}/tsconfig.json`))
        const expected = resolveTypescript('@/value', importer, config)
        expect(expected).toBe(
          normalize(join(root, `packages/${name}/src/value.ts`))
        )
        expect(
          (await server.pluginContainer.resolveId('@/value', importer))?.id
        ).toBe(expected)
        expect(
          resolveTypescript('@/parentOnly', importer, config)
        ).toBeUndefined()
        expect(
          await server.pluginContainer.resolveId('@/parentOnly', importer)
        ).toBeNull()

        // Project fallback is plugin policy. Once the child excludes this
        // importer, compare with the root config that actually includes it.
        const excluded = join(root, `packages/${name}/src/excluded.ts`)
        const parent = parseConfig(join(root, 'tsconfig.json'))
        expect(config.fileNames.map(normalize)).not.toContain(
          normalize(excluded)
        )
        expect(parent.fileNames.map(normalize)).toContain(normalize(excluded))
        expect(
          (await server.pluginContainer.resolveId('@/value', excluded))?.id
        ).toBe(resolveTypescript('@/value', excluded, parent))
      }
    } finally {
      await server?.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test.each([
  { name: 'default outDir exclusion', exclude: undefined },
  {
    name: 'explicit test and outDir exclusions',
    exclude: ['**/*.test.ts', 'src/generated'],
  },
  {
    name: 'explicit exclude overrides the default outDir exclusion',
    exclude: ['**/*.test.ts'],
  },
  { name: 'empty exclude overrides the default outDir exclusion', exclude: [] },
])('$name matches TypeScript root file selection', async ({ exclude }) => {
  await expectFileSelection(exclude)
})

async function expectFileSelection(exclude: string[] | undefined) {
  const root = makeRoot()
  try {
    writeConfig(
      root,
      'tsconfig.json',
      { outDir: './src/generated' },
      {
        include: ['src/**/*.ts'],
        exclude,
      }
    )
    const files = [
      'src/index.ts',
      'src/nested/index.ts',
      'src/index.test.ts',
      'outside/index.ts',
      'src/generated/index.ts',
    ]
    for (const file of [...files, 'src/value.ts'])
      write(root, file, 'export {}')
    const config = parseConfig(join(root, 'tsconfig.json'))
    const resolvers = createTsconfigResolvers({
      projects: ['tsconfig.json'],
      projectRoot: root,
      workspaceRoot: root,
      logger: { error: vi.fn(), hasErrorLogged: () => true },
    })
    resolvers.reset()
    for (const file of files) {
      const importer = join(root, file)
      const included = config.fileNames
        .map(normalize)
        .includes(normalize(importer))
      let count = 0
      for await (const resolve of resolvers.get(importer)) {
        count++
        const [resolved, matched] = await resolve('@/value', importer)
        expect(matched, file).toBe(included)
        expect(resolved, file).toBe(
          included ? resolveTypescript('@/value', importer, config) : undefined
        )
      }
      expect(count).toBe(1)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('Vite queries preserve the TypeScript-resolved base path, including cache hits', async () => {
  const root = makeRoot()
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    writeConfig(root, 'tsconfig.json')
    write(root, 'src/index.ts', 'export {}')
    write(root, 'src/value.ts', 'export const value = true')
    const importer = join(root, 'src/index.ts')
    const config = parseConfig(join(root, 'tsconfig.json'))
    const expected = resolveTypescript('@/value', importer, config)
    expect(expected).toBe(normalize(join(root, 'src/value.ts')))
    server = await startServer(root)
    for (const query of ['?raw', '?url', '', '?raw']) {
      // TypeScript has no built-in meaning for Vite query suffixes.
      if (query)
        expect(
          resolveTypescript('@/value' + query, importer, config)
        ).toBeUndefined()
      const resolved = await server.pluginContainer.resolveId(
        '@/value' + query,
        importer + '?v=1#fragment'
      )
      expect(resolved?.id).toBe(expected + query)
    }
  } finally {
    await server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test.each(['vue', 'svelte'])(
  'allowJs supports .%s importers beyond TypeScript root file selection',
  async (extension) => {
    const root = makeRoot()
    try {
      writeConfig(root, 'tsconfig.json', { allowJs: true })
      write(root, 'src/value.ts', 'export const value = true')
      const importer = join(root, `src/Component.${extension}`)
      write(root, `src/Component.${extension}`, '')
      const config = parseConfig(join(root, 'tsconfig.json'))
      // Framework tooling supplies these modules; plain TypeScript doesn't
      // select them as source files, even though its resolver accepts a path.
      expect(config.fileNames.map(normalize)).not.toContain(normalize(importer))
      const resolvers = createTsconfigResolvers({
        projects: ['tsconfig.json'],
        projectRoot: root,
        workspaceRoot: root,
        logger: { error: vi.fn(), hasErrorLogged: () => true },
      })
      resolvers.reset()
      let count = 0
      for await (const resolve of resolvers.get(importer)) {
        count++
        const expected = resolveTypescript('@/value', importer, config)
        expect(expected).toBe(normalize(join(root, 'src/value.ts')))
        expect(await resolve('@/value', importer)).toEqual([expected, true])
      }
      expect(count).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)

test.each(['eager', 'lazy'] as const)(
  'dev server config edits match a fresh TypeScript resolution with %s discovery',
  async (discovery) => {
    const root = makeRoot()
    let server: Awaited<ReturnType<typeof createServer>> | undefined
    try {
      writeConfig(root, 'tsconfig.json')
      write(root, 'src/index.ts', 'export {}')
      write(root, 'src/value.ts', 'export const value = "old"')
      write(root, 'next/value.ts', 'export const value = "new"')
      server = await startServer(root, discovery, true)
      const importer = join(root, 'src/index.ts')
      expect(
        (await server.pluginContainer.resolveId('@/value', importer))?.id
      ).toBe(
        resolveTypescript(
          '@/value',
          importer,
          parseConfig(join(root, 'tsconfig.json'))
        )
      )
      writeConfig(root, 'tsconfig.json', { paths: { '@/*': ['./next/*'] } })
      const expected = resolveTypescript(
        '@/value',
        importer,
        parseConfig(join(root, 'tsconfig.json'))
      )
      expect(expected).toBe(normalize(join(root, 'next/value.ts')))
      await vi.waitFor(
        async () => {
          expect(
            (await server!.pluginContainer.resolveId('@/value', importer))?.id
          ).toBe(expected)
        },
        { timeout: 5000 }
      )
    } finally {
      await server?.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
)

function makeRoot() {
  return realpathSync(
    mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-parity-'))
  )
}

function write(root: string, file: string, contents: string) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function writeConfig(
  root: string,
  file: string,
  compilerOptions = {},
  config = {}
) {
  write(
    root,
    file,
    JSON.stringify({
      ...config,
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        jsx: 'preserve',
        resolveJsonModule: true,
        ignoreDeprecations: '6.0',
        paths: { '@/*': ['./src/*'] },
        ...compilerOptions,
      },
    })
  )
}

function parseConfig(file: string) {
  const config = ts.getParsedCommandLineOfConfigFile(
    file,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
        )
      },
    }
  )!
  expect(
    config.errors.map((error) =>
      ts.flattenDiagnosticMessageText(error.messageText, '\n')
    )
  ).toEqual([])
  return config
}

function resolveTypescript(
  id: string,
  importer: string,
  config: ts.ParsedCommandLine
) {
  const result = ts.resolveModuleName(
    id,
    importer,
    config.options,
    ts.sys
  ).resolvedModule
  return result && normalize(realpathSync(result.resolvedFileName))
}

function startServer(
  root: string,
  projectDiscovery: 'eager' | 'lazy' = 'eager',
  watch = false
) {
  return createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      // Wait before editing files: a watched directory can appear in
      // getWatched() before its initial scan has finished.
      watch && {
        name: 'wait-for-watcher',
        configureServer(server) {
          return new Promise<void>((resolve) => {
            server.watcher.once('ready', resolve)
          })
        },
      },
      tsconfigPaths({ root, projectDiscovery }),
    ],
    server: { middlewareMode: true, watch: watch ? {} : null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
}
