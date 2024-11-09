import { readdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { execa } from 'execa'
import * as vite from 'vite'
import tsconfigPaths from '../src/index.js'

const tscBinPath = resolve(__dirname, '../node_modules/.bin/tsc')

const fixturesDir = join(__dirname, '__fixtures__')

for (const name of readdirSync(fixturesDir)) {
  const fixtureDir = join(fixturesDir, name)

  test.concurrent(name, async () => {
    await Promise.all([
      expectTscToSucceed(fixtureDir),
      expectViteToSucceed(fixtureDir),
    ])
  })
}

async function expectTscToSucceed(fixtureDir: string) {
  const { exitCode, stderr } = await execa(
    tscBinPath,
    ['-p', '.', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist'],
    {
      cwd: fixtureDir,
      reject: false,
    }
  )
  expect(stderr).toBe('')
  expect(exitCode).toBe(0)
}

async function expectViteToSucceed(fixtureDir: string) {
  await expect(
    vite.build({
      configFile: false,
      root: fixtureDir,
      plugins: [tsconfigPaths()],
      logLevel: 'error',
      build: {
        lib: {
          entry: 'index.ts',
          formats: ['es'],
        },
      },
    })
  ).resolves.not.toThrow()
}
