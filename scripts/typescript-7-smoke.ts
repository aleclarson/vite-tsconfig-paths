import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { execa } from 'execa'

const root = process.cwd()
const smokeDir = realpathSync(
  mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-ts7-'))
)

const packed = await execa(
  'pnpm',
  ['pack', '--pack-destination', smokeDir, '--config.ignore-scripts=true'],
  { cwd: root }
)

const packageTarball = join(smokeDir, basename(packed.stdout.trim()))
const viteStub = join(smokeDir, 'vite-stub')
mkdirSync(viteStub)
writeFileSync(
  join(viteStub, 'package.json'),
  JSON.stringify({
    name: 'vite',
    version: '8.0.0',
    type: 'module',
    main: 'index.js',
  })
)
writeFileSync(
  join(viteStub, 'index.js'),
  `export const normalizePath = path => path.replaceAll('\\\\', '/')
export const searchForWorkspaceRoot = path => path
`
)
const oxcResolverStub = join(smokeDir, 'oxc-resolver-stub')
mkdirSync(oxcResolverStub)
writeFileSync(
  join(oxcResolverStub, 'package.json'),
  JSON.stringify({
    name: 'oxc-resolver',
    version: '11.19.1',
    type: 'module',
    main: 'index.js',
  })
)
writeFileSync(
  join(oxcResolverStub, 'index.js'),
  'export class ResolverFactory {}\n'
)
const packageJson = {
  private: true,
  type: 'module',
  pnpm: {
    overrides: {
      'oxc-resolver': 'file:./oxc-resolver-stub',
    },
  },
  dependencies: {
    typescript: fileDependency(
      smokeDir,
      realpathSync('node_modules/typescript-7')
    ),
    vite: 'file:./vite-stub',
    'vite-tsconfig-paths': fileDependency(smokeDir, packageTarball),
  },
}

writeFileSync(
  join(smokeDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
)
await execa('pnpm', ['install', '--offline', '--ignore-scripts'], {
  cwd: smokeDir,
})

writeFileSync(
  join(smokeDir, 'block-typescript.mjs'),
  `export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'typescript' || specifier.startsWith('typescript/')) {
    throw new Error('The plugin attempted to load the TypeScript compiler')
  }
  return nextResolve(specifier, context)
}
`
)

const result = await execa(
  process.execPath,
  [
    '--experimental-loader',
    './block-typescript.mjs',
    '--input-type=module',
    '--eval',
    `
      import tsconfigPaths from 'vite-tsconfig-paths'
      import { readFileSync } from 'node:fs'

      const pluginPackage = JSON.parse(
        readFileSync(new URL('./node_modules/vite-tsconfig-paths/package.json', import.meta.url))
      )
      const typescriptPackage = JSON.parse(
        readFileSync(new URL('./node_modules/typescript/package.json', import.meta.url))
      )
      const plugin = tsconfigPaths()

      if (!typescriptPackage.version.startsWith('7.')) {
        throw new Error('Expected TypeScript 7, received ' + typescriptPackage.version)
      }
      if (pluginPackage.dependencies?.typescript || pluginPackage.peerDependencies?.typescript) {
        throw new Error('Published package must not depend on or peer-depend on TypeScript')
      }
      if (plugin.name !== 'vite-tsconfig-paths') {
        throw new Error('Failed to load the packaged plugin')
      }

      console.log('Loaded packaged plugin with TypeScript ' + typescriptPackage.version)
    `,
  ],
  { cwd: smokeDir }
)

console.log(result.stdout)

function fileDependency(from: string, target: string) {
  return `file:${relative(from, target).replaceAll('\\', '/')}`
}
