import { join } from 'path'
import * as vite from 'vite'
import tsconfigPaths from '../../src/index.js'
import { expectTscToSucceed, readTestConfig } from '../test-infra.js'

describe('Types in paths', () => {
  const config = readTestConfig(join(__dirname, '__fixtures__/types-in-paths'))

  it('should use type in tsc, and not fail', async () => {
    await expectTscToSucceed(config)
  })

  it('should fail vite build with correct error', async () => {
    // This test checks whether Vite fails with the expected error.
    // The error `Rollup failed to resolve import` means that the import wasn't replaced by the plugin.
    // If the import is replaced, then the error will be different: it will say something like `"foo" is not exported by`.
    await expect(
      vite.build({
        configFile: false,
        root: config.root,
        plugins: [tsconfigPaths()],
        logLevel: 'error',
        build: {
          lib: {
            entry: 'index.ts',
            formats: ['es'],
          },
        },
      })
    ).rejects.toThrow('Rollup failed to resolve import "my-utils/log" from')
  })
})
