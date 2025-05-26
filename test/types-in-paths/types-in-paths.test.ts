import { execa } from 'execa'
import { resolve, join } from 'path'
import * as vite from 'vite'
import tsconfigPaths from '../../src/index.js'

const tscBinPath = resolve(__dirname, '../../node_modules/.bin/tsc')

console.log('tscBinPath', tscBinPath)

describe('Types in paths', () => {
  it('should use type in tsc, and not fail', async () => {
    const config = {
      root: './my-app',
    }
    await expectTscToSucceed(config)
  })

  // Caused by: RollupError: test/types-in-paths/__fixtures__/types-in-paths/my-app/index.ts (1:9):
  // "foo" is not exported by "test/types-in-paths/__fixtures__/types-in-paths/my-utils/types/internal.d.ts", imported by "test/types-in-paths/__fixtures__/types-in-paths/my-app/index.ts".
  // file: /Users/artemdem/Development/vite-tsconfig-paths/test/types-in-paths/__fixtures__/types-in-paths/my-app/index.ts:1:9
  it('should fail vite build', async () => {
    await expect(
      vite.build({
        configFile: false,
        root: join(__dirname, '__fixtures__/types-in-paths', 'my-app'),
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

async function expectTscToSucceed(config: any) {
  const { exitCode, signal, stderr } = await execa(
    tscBinPath,
    ['-p', '.', '--declaration', '--emitDeclarationOnly', '--outDir', 'dist'],
    {
      cwd: join(__dirname, '__fixtures__/types-in-paths', config.root),
      reject: false,
    }
  )
  expect({ exitCode, signal, stderr }).toEqual({
    exitCode: 0,
    signal: undefined,
    stderr: '',
  })
}
