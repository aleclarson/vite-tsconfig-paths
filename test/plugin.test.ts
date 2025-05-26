import { readdirSync } from 'fs'
import { join } from 'path'
import * as vite from 'vite'
import tsconfigPaths from '../src/index.js'
import { expectTscToSucceed, readTestConfig, TestConfig } from './test-infra.js'

const fixturesDir = join(__dirname, '__fixtures__')

for (const name of readdirSync(fixturesDir)) {
  const fixtureDir = join(fixturesDir, name)

  test.concurrent(name, async () => {
    const config = readTestConfig(fixtureDir)

    await Promise.all([expectTscToSucceed(config), expectViteToSucceed(config)])
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
