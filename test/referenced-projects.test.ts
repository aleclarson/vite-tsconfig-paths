import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vite from 'vite'
import * as tsconfck from 'tsconfck'
import { normalize } from '../src/path'
import { createTsconfigResolvers } from '../src/resolver'

vi.mock('tsconfck', async (importOriginal) => {
  const actual = await importOriginal<typeof tsconfck>()
  return { ...actual, parse: vi.fn(actual.parse) }
})

let root: string

beforeEach(async () => {
  root = normalize(
    await realpath(await mkdtemp(join(tmpdir(), 'vite-tsconfig-references-')))
  )
  await Promise.all(
    ['.config', 'app', 'tests', 'excluded', 'nested'].map((dir) =>
      mkdir(fixturePath(dir))
    )
  )
  await Promise.all(
    ['app/first.ts', 'app/second.ts', 'nested/local.ts'].map((file) =>
      writeFile(fixturePath(file), 'export default 1')
    )
  )
  await writeConfig('tsconfig.json', {
    files: [],
    references: [{ path: './.config/tsconfig.app.json' }],
  })
  await writeReference('first')
})

afterEach(async () => {
  vi.mocked(tsconfck.parse).mockReset()
  await rm(root, { recursive: true, force: true })
})

for (const projectDiscovery of ['eager', 'lazy'] as const) {
  describe(projectDiscovery, () => {
    function createResolvers() {
      const resolvers = createTsconfigResolvers({
        projectRoot: root,
        workspaceRoot: root,
        projectDiscovery,
        ignoreConfigErrors: true,
        logger: vite.createLogger('silent'),
      })
      const watcher = Object.assign(new EventEmitter(), { add: vi.fn() })
      resolvers.watch(watcher as unknown as vite.FSWatcher)
      resolvers.reset()
      return { resolvers, watcher }
    }

    test.sequential('references do not leak to unrelated projects or unsupported importers', async () => {
      const { resolvers } = createResolvers()
      expect(await resolve(resolvers, fixturePath('tests/index.ts'))).toBe(
        fixturePath('app/first.ts')
      )
      expect(
        await resolve(resolvers, fixturePath('tests/index.js'))
      ).toBeUndefined()
      expect(
        await resolve(resolvers, fixturePath('../unrelated/index.ts'))
      ).toBeUndefined()
    })

    test.sequential('closer projects take precedence for colliding aliases', async () => {
      await writeConfig('nested/tsconfig.json', {
        compilerOptions: { paths: { '@value': ['./local.ts'] } },
      })
      const { resolvers } = createResolvers()
      expect(await resolve(resolvers, fixturePath('nested/index.ts'))).toBe(
        fixturePath('nested/local.ts')
      )
    })

    test.sequential('parent include and exclude constrain referenced aliases', async () => {
      await writeConfig('tsconfig.json', {
        include: ['tests/**/*.ts', 'excluded/**/*.ts'],
        exclude: ['excluded'],
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      const { resolvers } = createResolvers()
      expect(await resolve(resolvers, fixturePath('tests/index.ts'))).toBe(
        fixturePath('app/first.ts')
      )
      expect(
        await resolve(resolvers, fixturePath('excluded/index.ts'))
      ).toBeUndefined()
      expect(
        await resolve(resolvers, fixturePath('nested/index.ts'))
      ).toBeUndefined()
    })

    test.sequential('parent absolute include and outDir use the same scope normalization', async () => {
      await writeConfig('tsconfig.json', {
        include: [fixturePath('tests'), fixturePath('excluded')],
        compilerOptions: { outDir: fixturePath('excluded') },
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      const { resolvers } = createResolvers()
      expect(
        await resolve(resolvers, fixturePath('tests/index.ts?query'))
      ).toBe(fixturePath('app/first.ts'))
      expect(
        await resolve(resolvers, fixturePath('excluded/index.ts'))
      ).toBeUndefined()
    })

    test.sequential('parent scope refreshes when its extended config changes', async () => {
      await writeConfig('scope.json', {
        include: ['tests'],
        exclude: ['excluded'],
      })
      await writeConfig('tsconfig.json', {
        extends: './scope.json',
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      expect(
        await resolve(resolvers, fixturePath('excluded/index.ts'))
      ).toBeUndefined()
      expect(watcher.add).toHaveBeenCalledWith(fixturePath('scope.json'))
      await writeConfig('scope.json', {
        include: ['tests', 'excluded'],
        exclude: ['tests'],
      })
      watcher.emit('all', 'change', fixturePath('scope.json'))
      await expect.poll(() => resolve(resolvers, importer)).toBeUndefined()
      expect(await resolve(resolvers, fixturePath('excluded/index.ts'))).toBe(
        fixturePath('app/first.ts')
      )
    })

    test.sequential('overlapping changes cannot install a stale reference graph', async () => {
      await writeConfig('tsconfig.json', {
        include: ['tests'],
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      const { parse } = await vi.importActual<typeof tsconfck>('tsconfck')
      let releaseOldParse!: () => void
      let releaseLatestParse!: () => void
      let notifyOldParse!: () => void
      let notifyLatestParse!: () => void
      const oldParseReady = new Promise<void>((resolve) => {
        notifyOldParse = resolve
      })
      const latestParseReady = new Promise<void>((resolve) => {
        notifyLatestParse = resolve
      })
      const oldParseBlocked = new Promise<void>((resolve) => {
        releaseOldParse = resolve
      })
      const latestParseBlocked = new Promise<void>((resolve) => {
        releaseLatestParse = resolve
      })
      let parseCount = 0
      vi.mocked(tsconfck.parse).mockImplementation(async (...args) => {
        const index = parseCount++
        const result = await parse(...args)
        if (index === 0) {
          notifyOldParse()
          await oldParseBlocked
        } else if (index === 1) {
          notifyLatestParse()
          await latestParseBlocked
        }
        return result
      })
      await writeReference('second')
      watcher.emit('all', 'change', fixturePath('.config/tsconfig.app.json'))
      const staleResolution = resolve(resolvers, importer)
      await oldParseReady
      await writeReference('first')
      await writeConfig('tsconfig.json', {
        include: ['excluded'],
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      watcher.emit('all', 'change', fixturePath('.config/tsconfig.app.json'))
      const latestImporter = fixturePath('excluded/index.ts')
      const latestResolution = resolve(resolvers, latestImporter)
      await latestParseReady
      // The stale parse completes while the latest graph is still loading.
      // Without generation guards it wins duplicate-project insertion.
      releaseOldParse()
      await staleResolution
      releaseLatestParse()
      expect(await latestResolution).toBe(fixturePath('app/first.ts'))
      expect(await resolve(resolvers, importer)).toBeUndefined()
      expect(await resolve(resolvers, latestImporter)).toBe(
        fixturePath('app/first.ts')
      )
    })

    test.sequential('referenced aliases refresh after a config change', async () => {
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      await writeReference('second')
      watcher.emit('all', 'change', fixturePath('.config/tsconfig.app.json'))
      await expect
        .poll(() => resolve(resolvers, importer))
        .toBe(fixturePath('app/second.ts'))
    })

    test.sequential('referenced aliases refresh when an extended config changes', async () => {
      await writeConfig('.config/paths.json', {
        compilerOptions: { paths: { '@value': ['../app/first.ts'] } },
      })
      await writeConfig('.config/tsconfig.app.json', {
        extends: './paths.json',
        include: ['../app'],
      })
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      expect(watcher.add).toHaveBeenCalledWith(
        fixturePath('.config/paths.json')
      )
      await writeConfig('.config/paths.json', {
        compilerOptions: { paths: { '@value': ['../app/second.ts'] } },
      })
      watcher.emit('all', 'change', fixturePath('.config/paths.json'))
      await expect
        .poll(() => resolve(resolvers, importer))
        .toBe(fixturePath('app/second.ts'))
    })

    test.sequential('removing and restoring a parent reference refreshes aliases', async () => {
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      await writeConfig('tsconfig.json', { files: [] })
      watcher.emit('all', 'change', fixturePath('tsconfig.json'))
      await expect.poll(() => resolve(resolvers, importer)).toBeUndefined()
      await writeConfig('tsconfig.json', {
        files: [],
        references: [{ path: './.config/tsconfig.app.json' }],
      })
      watcher.emit('all', 'change', fixturePath('tsconfig.json'))
      await expect
        .poll(() => resolve(resolvers, importer))
        .toBe(fixturePath('app/first.ts'))
    })

    test.sequential('deleted references stop resolving and recover when recreated', async () => {
      const { resolvers, watcher } = createResolvers()
      const importer = fixturePath('tests/index.ts')
      expect(await resolve(resolvers, importer)).toBe(
        fixturePath('app/first.ts')
      )
      await rm(fixturePath('.config/tsconfig.app.json'))
      watcher.emit('all', 'unlink', fixturePath('.config/tsconfig.app.json'))
      await expect.poll(() => resolve(resolvers, importer)).toBeUndefined()
      await writeReference('second')
      watcher.emit('all', 'add', fixturePath('.config/tsconfig.app.json'))
      await expect
        .poll(() => resolve(resolvers, importer))
        .toBe(fixturePath('app/second.ts'))
    })
  })
}

function fixturePath(relative: string) {
  return normalize(join(root, relative))
}

async function writeConfig(file: string, config: unknown) {
  await writeFile(fixturePath(file), JSON.stringify(config))
}

async function writeReference(target: string) {
  await writeConfig('.config/tsconfig.app.json', {
    compilerOptions: { paths: { '@value': [`../app/${target}.ts`] } },
    include: ['../app'],
  })
}

async function resolve(
  resolvers: ReturnType<typeof createTsconfigResolvers>,
  importer: string
) {
  for await (const resolver of resolvers.get(importer)) {
    const [resolved, matched] = await resolver('@value', importer)
    if (resolved || matched) return resolved
  }
}
