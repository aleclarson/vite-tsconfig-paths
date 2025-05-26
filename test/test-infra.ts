import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execa } from 'execa'
import { type PluginOptions } from '../src/index.js'

export const tscBinPath = resolve(__dirname, '../node_modules/.bin/tsc')

export type TestConfig = ReturnType<typeof readTestConfig>

export function readTestConfig(fixtureDir: string) {
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

export async function expectTscToSucceed(config: TestConfig) {
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
