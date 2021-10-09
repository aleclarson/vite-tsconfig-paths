import { configs } from './mocks'
import { getResolver, viteResolve } from './resolver'

describe('tsconfig precedence', () => {
  it('prefers nearest tsconfig', async () => {
    const resolveId = getResolver({
      root: '/a/b',
      // Load the higher config first to prove sorting works.
      projects: ['..', '.'],
    })

    viteResolve.mockImplementation((id) => id)

    // Import from /a/b/
    let result = await resolveId('c', '/a/b/main.ts')
    expect(result).toBe('/a/b/c')

    // Import from /a/
    result = await resolveId('c', '/a/main.ts')
    expect(result).toBe('/a/c')

    // Import from /
    result = await resolveId('c', '/main.ts')
    expect(result).toBeUndefined()
  })
})

describe('absolute paths in projects array', () => {
  test('posix paths', async () => {
    const resolveId = getResolver({
      projects: ['/a/b'],
    })
    viteResolve.mockImplementation((id) => id)
    const result = await resolveId('c', '/a/b/b/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/b/c"`)
  })
  test('windows-style paths', async () => {
    const resolveId = getResolver({
      projects: ['D:\\a\\b'],
    })
    viteResolve.mockImplementation((id) => id)
    const result = await resolveId('c', 'D:\\a\\b\\b\\main.ts')
    expect(result).toMatchInlineSnapshot(`"D:/a/b/c"`)
  })
})

describe('include array', () => {
  it('can include files outside the config root', async () => {
    configs['/a/b/']!.include = ['../x']
    const resolveId = getResolver({
      projects: ['/a/b'],
    })
    viteResolve.mockImplementation((id) => id)
    const result = await resolveId('c', '/a/x/main.ts')
    expect(result).toBeDefined()
    expect(result).toMatchInlineSnapshot(`"/a/b/c"`)
  })

  it('can contain a path prefixed with ./', async () => {
    configs['/a/']!.include = ['./src']
    const resolveId = getResolver({
      projects: ['/a'],
    })

    viteResolve.mockImplementation((id) => id)
    let result = await resolveId('c', '/a/src/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)

    // All descendants are matched.
    result = await resolveId('c', '/a/src/b/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)
  })

  it('can contain a path with no prefix and no glob', async () => {
    configs['/a/']!.include = ['src']
    const resolveId = getResolver({
      projects: ['/a'],
    })

    viteResolve.mockImplementation((id) => id)
    let result = await resolveId('c', '/a/src/b.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)

    // All descendants are matched.
    result = await resolveId('c', '/a/src/b/index.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)
  })

  it('can contain a glob', async () => {
    configs['/a/']!.include = ['src/**/__tests__']
    const resolveId = getResolver({
      projects: ['/a'],
    })

    viteResolve.mockImplementation((id) => id)
    let result = await resolveId('c', '/a/src/__tests__/x.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)

    result = await resolveId('c', '/a/src/b/__tests__/x.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)

    // This importer is not included.
    result = await resolveId('c', '/a/src/main.ts')
    expect(result).toMatchInlineSnapshot(`undefined`)
  })

  it('can contain a path that ends with /', async () => {
    configs['/a/']!.include = ['src/']
    const resolveId = getResolver({
      projects: ['/a'],
    })

    viteResolve.mockImplementation((id) => id)
    let result = await resolveId('c', '/a/src/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)

    // All descendants are matched.
    result = await resolveId('c', '/a/src/b/main.ts')
    expect(result).toMatchInlineSnapshot(`"/a/c"`)
  })

  it('ignores query in importer path', async () => {
    configs['/a/']!.include = ['src/**/*.vue']
    const resolveId = getResolver({
      projects: ['/a'],
      loose: true,
    })

    viteResolve.mockImplementation((id) => {
      return id
    })
    const result = await resolveId(
      'c',
      '/a/src/main.vue?vue&type=template&lang.js'
    )
    expect(result).toMatchInlineSnapshot(`"/a/c"`)
  })
})
