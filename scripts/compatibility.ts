import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { execa } from 'execa'

const mode = process.argv[2]
if (mode !== 'vite' && mode !== 'node') {
  throw new Error('Usage: tsx scripts/compatibility.ts <vite|node>')
}

const root = process.cwd()
const directory = realpathSync(
  mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-compat-'))
)
try {
  const packed = await execa('pnpm', [
    'pack',
    '--pack-destination',
    directory,
    '--config.ignore-scripts=true',
  ])
  const tarball = join(directory, basename(packed.stdout.trim()))
  const fixture = readFileSync(
    join(root, 'scripts/compatibility-fixture.mjs'),
    'utf8'
  )
  for (const major of mode === 'vite' ? [5, 6, 7] : [5, 6, 7, 8]) {
    // Each version gets a fresh installation of the packed plugin.
    const cwd = join(directory, `vite-${major}`)
    mkdirSync(cwd)
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({
        private: true,
        type: 'module',
        dependencies: {
          vite: String(major),
          'vite-tsconfig-paths': `file:${tarball}`,
          ...(mode === 'node' ? { node: '20.20.0' } : {}),
        },
      })
    )
    console.log(
      `Installing Vite ${major}${mode === 'node' ? ' with Node 20.20.0' : ''}…`
    )
    await execa('npm', ['install', '--no-audit', '--no-fund'], {
      cwd,
      timeout: 180_000,
    })
    writeFileSync(join(cwd, 'check.mjs'), fixture)
    const executable =
      mode === 'node'
        ? join(
            cwd,
            'node_modules/node/bin',
            process.platform === 'win32' ? 'node.exe' : 'node'
          )
        : process.execPath
    await execa(
      executable,
      ['check.mjs', ...(mode === 'node' ? ['20.20.0'] : [])],
      {
        cwd,
        stdio: 'inherit',
        timeout: 60_000,
      }
    )
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
