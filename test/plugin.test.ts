import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execa } from 'execa'
import * as vite from 'vite'
import tsconfigPaths, { type PluginOptions } from '../src/index.js'

const tscBinPath = resolve(__dirname, '../node_modules/.bin/tsc')

const fixturesDir = join(__dirname, '__fixtures__')

for (const name of readdirSync(fixturesDir)) {
  const fixtureDir = join(fixturesDir, name)

  test.concurrent(name, async () => {
    const config = readTestConfig(fixtureDir)

    await Promise.all([expectTscToSucceed(config), expectViteToSucceed(config)])
  })
}

async function expectTscToSucceed(config: TestConfig) {
  const { exitCode, signal, stderr } = await execa(
    tscBinPath,
    ['-p', '.', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist'],
    {
      cwd: config.root,
      reject: false,
    }
  )
  expect({ exitCode, signal, stderr }).toEqual({
    exitCode: 0,
    signal: undefined,
    stderr: '',
  })
}

async function expectViteToSucceed(config: TestConfig) {
  await expect(
    vite.build({
      configFile: false,
      root: config.root,
      plugins: [tsconfigPaths(config.options)],
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

type TestConfig = ReturnType<typeof readTestConfig>

function readTestConfig(fixtureDir: string) {
  let config: {
    /** Vite project root */
    root?: string
    /** Plugin options */
    options?: PluginOptions
  }
  try {
    config = JSON.parse(readFileSync(join(fixtureDir, 'config.json'), 'utf-8'))
    if (config.root) {
      config.root = resolve(fixtureDir, config.root)
    }
  } catch {
    config = {}
  }
  return {
    root: fixtureDir,
    ...config,
    options: {
      ...config.options,
      root: resolve(fixtureDir, config.options?.root ?? config.root ?? ''),
    },
  }
}
