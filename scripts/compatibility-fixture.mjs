import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build, createServer, version } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

if (process.argv[2]) assert.equal(process.versions.node, process.argv[2])
mkdirSync('src')
writeFileSync(
  'tsconfig.json',
  JSON.stringify({
    compilerOptions: { paths: { '@/*': ['./src/*'] } },
    include: ['src'],
  })
)
writeFileSync('src/value.ts', 'export const value: string = "compatibility-ok"')
writeFileSync(
  'src/index.ts',
  'import { value } from "@/value"; export { value }'
)

for (const projectDiscovery of ['eager', 'lazy']) {
  const config = {
    configFile: false,
    root: process.cwd(),
    plugins: [tsconfigPaths({ projectDiscovery })],
    logLevel: 'error',
  }
  const server = await createServer({
    ...config,
    server: { watch: null, ws: false },
  })
  try {
    const resolved = await server.pluginContainer.resolveId(
      '@/value',
      resolve('src/index.ts')
    )
    assert.equal(
      resolved?.id.replaceAll('\\', '/'),
      resolve('src/value.ts').replaceAll('\\', '/')
    )
    const transformed = await server.transformRequest('/src/index.ts')
    assert.ok(transformed?.code.includes('/src/value.ts'))
  } finally {
    await server.close()
  }
  const output = await build({
    ...config,
    plugins: [tsconfigPaths({ projectDiscovery })],
    build: {
      write: false,
      minify: false,
      lib: { entry: 'src/index.ts', fileName: 'index', formats: ['es'] },
    },
  })
  const bundles = Array.isArray(output) ? output : [output]
  assert.ok(
    bundles.some((bundle) =>
      bundle.output.some(
        (item) =>
          item.type === 'chunk' && item.code.includes('compatibility-ok')
      )
    )
  )
}
console.log(
  `PASS: Vite ${version}, Node ${process.versions.node} — eager/lazy dev resolution and build`
)
