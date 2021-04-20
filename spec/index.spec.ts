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
