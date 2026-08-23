import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
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
const typescriptPackage = JSON.parse(
  readFileSync('node_modules/typescript-7/package.json', 'utf8')
)
const typescriptStub = createStubPackage(
  'typescript',
  typescriptPackage.version,
  `export const version = ${JSON.stringify(typescriptPackage.version)}\n`
)
const viteStub = createStubPackage(
  'vite',
  '8.0.0',
  `export const normalizePath = path => path.replaceAll('\\\\', '/')
export const searchForWorkspaceRoot = path => path
`
)
const debugStub = createStubPackage(
  'debug',
  '4.4.3',
  `const createDebug = () => Object.assign(() => {}, { enabled: false })
createDebug.enable = () => {}
export default createDebug
`
)
const getTsconfigStub = createStubPackage(
  'get-tsconfig',
  '5.0.0-beta.6',
  `export function readTsconfig() {
  throw new Error('Not used by the package-load smoke test')
}
`
)
const oxcResolverStub = createStubPackage(
  'oxc-resolver',
  '11.19.1',
  'export class ResolverFactory {}\n'
)
const packageJson = {
  private: true,
  type: 'module',
  pnpm: {
    overrides: {
      debug: debugStub,
      'get-tsconfig': getTsconfigStub,
      'oxc-resolver': oxcResolverStub,
    },
  },
  dependencies: {
    typescript: typescriptStub,
    vite: viteStub,
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

function createStubPackage(name: string, version: string, source: string) {
  const directoryName = `${name}-stub`
  const directory = join(smokeDir, directoryName)
  mkdirSync(directory)
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name, version, type: 'module', main: 'index.js' })
  )
  writeFileSync(join(directory, 'index.js'), source)
  return `file:./${directoryName}`
}
