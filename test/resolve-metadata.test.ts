import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, createServer, normalizePath, type Rollup } from 'vite'
import tsconfigPaths from '../src/index'

test('applies package sideEffects to path-mapped imports', async () => {
  const root = createProject()
  try {
    const result = (await build({
      configFile: false,
      root,
      plugins: [tsconfigPaths()],
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        lib: { entry: 'src/index.ts', formats: ['es'] },
      },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]

    const code = (Array.isArray(result) ? result : [result])
      .flatMap((result) => result.output)
      .filter((item) => item.type === 'chunk')
      .map((chunk) => chunk.code)
      .join('\n')
    expect(code).toContain('entry')
    expect(code).not.toContain('effect executed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('preserves plugin resolution results for cached paths and queries', async () => {
  const root = createProject()
  const effectId = normalizePath(join(root, 'src/effect.ts'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  try {
    server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true },
      plugins: [
        tsconfigPaths(),
        {
          name: 'resolve-effect',
          enforce: 'pre',
          resolveId(id, _importer, options) {
            if (id === effectId || id === effectId + '?raw') {
              return {
                id,
                external: true,
                moduleSideEffects: false,
                meta: { resolution: options.custom?.resolution },
              }
            }
          },
        },
      ],
    })

    for (const [attempt, query] of ['', '?raw', ''].entries()) {
      const result = await server.pluginContainer.resolveId(
        '@/effect' + query,
        join(root, 'src/index.ts'),
        { custom: { resolution: { attempt } } }
      )
      expect(result).toMatchObject({
        id: effectId + query,
        external: true,
        moduleSideEffects: false,
        meta: { resolution: { attempt } },
      })
    }
  } finally {
    await server?.close()
    rmSync(root, { recursive: true, force: true })
  }
})

function createProject() {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-metadata-'))
  )
  mkdirSync(join(root, 'src'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ sideEffects: false })
  )
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
  )
  writeFileSync(
    join(root, 'src/index.ts'),
    'import "@/effect"; console.log("entry")'
  )
  writeFileSync(join(root, 'src/effect.ts'), 'console.log("effect executed")')
  return root
}
