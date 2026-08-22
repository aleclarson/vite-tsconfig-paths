import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { findAllProjects, loadProjectGraph } from '../src/config'

describe('loadProjectGraph', () => {
  test('parses JSONC, multiple extends, packages, symlinks, and configDir', () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-config-'))
    write(root, 'bases/first.json', '{ "compilerOptions": { "strict": true } }')
    write(
      root,
      'packages/shared/package.json',
      JSON.stringify({ name: '@fixture/shared', tsconfig: 'tsconfig.json' })
    )
    write(
      root,
      'packages/shared/tsconfig.json',
      JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } })
    )
    mkdirSync(join(root, 'node_modules/@fixture'), { recursive: true })
    symlinkSync(
      join(root, 'packages/shared'),
      join(root, 'node_modules/@fixture/shared'),
      'dir'
    )
    write(
      root,
      'tsconfig.json',
      `{
        // JSONC is supported.
        "extends": ["./bases/first.json", "@fixture/shared"],
        "include": ["\${configDir}/src/**/*.ts"],
      }`
    )

    const project = loadProjectGraph(join(root, 'tsconfig.json'))

    expect(project.tsconfig.compilerOptions?.strict).toBe(true)
    expect(project.tsconfig.compilerOptions?.paths).toEqual({
      '@/*': ['./src/*'],
    })
    expect(project.tsconfig.include).toEqual([join(root, 'src/**/*.ts')])
    expect(new Set(project.sourcePaths)).toEqual(
      new Set([
        join(root, 'tsconfig.json'),
        join(root, 'bases/first.json'),
        realpathSync(join(root, 'node_modules/@fixture/shared/tsconfig.json')),
      ])
    )
  })

  test('loads recursive references once and breaks reference cycles', () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-refs-'))
    write(root, 'tsconfig.json', reference('./packages/a'))
    write(root, 'packages/a/tsconfig.json', reference('../b'))
    write(root, 'packages/b/tsconfig.json', reference('../a'))

    const project = loadProjectGraph(join(root, 'tsconfig.json'))
    const a = project.referenced?.[0]
    const b = a?.referenced?.[0]

    expect(b?.referenced?.[0]).toBe(a)
  })
})

describe('findAllProjects', () => {
  test('honors names and skip rules with deterministic ordering', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vite-tsconfig-paths-find-'))
    write(root, 'z/tsconfig.json', '{}')
    write(root, 'a/jsconfig.json', '{}')
    write(root, 'ignored/tsconfig.json', '{}')
    write(root, 'a/not-a-config.json', '{}')

    const projects = await findAllProjects(
      root,
      ['tsconfig.json', 'jsconfig.json'],
      (name) => name === 'ignored'
    )

    expect(projects.map((file) => relative(root, file))).toEqual([
      'a/jsconfig.json',
      'z/tsconfig.json',
    ])
  })
})

function reference(path: string) {
  return JSON.stringify({ references: [{ path }] })
}

function write(root: string, file: string, contents: string) {
  const target = join(root, file)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, contents)
}
