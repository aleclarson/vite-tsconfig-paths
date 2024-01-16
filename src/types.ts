export interface PluginOptions {
  /**
   * The directory to crawl for `tsconfig.json` files.
   *
   * When the `projects` option is set, crawling is skipped, so this is
   * used to resolve `projects` paths into absolute paths instead.
   *
   * @default
   * // The config root is used for resolving project paths, and the
   * // workspace root is used for crawling.
   * options.projects ? viteConfig.root :
   * vite.searchForWorkspaceRoot(viteConfig.root)
   */
  root?: string
  /**
   * An array of `.json` files and/or directories that contain a
   * `tsconfig.json` file. These JSON files must adhere to the
   * {@link https://www.typescriptlang.org/tsconfig TypeScript config interface}. The `extends` property is supported.
   *
   * This disables crawling for `tsconfig.json` files when defined.
   */
  projects?: string[]
  /**
   * Disable strictness that limits path resolution to TypeScript
   * and JavaScript modules.
   *
   * Useful if you want asset URLs in Vue templates to be resolved,
   * or when `"allowJs": true` in your tsconfig isn't good enough.
   */
  loose?: boolean
  /**
   * Enable use of `tsconfck.parseNative` function, which delegates the
   * loading of `tsconfig.json` files to the TypeScript compiler. You'll
   * probably never need this, but I added it just in case.
   *
   * ⚠️ This option can slow down Vite's startup time by as much as
   * 600ms, due to the size of the TypeScript compiler. Only use it when
   * necessary.
   */
  parseNative?: boolean
  /**
   * Silence the warning about malformed `tsconfig.json` files.
   */
  ignoreConfigErrors?: boolean
  /**
   * An array of `tsconfig.json` file names to search for.
   * @default ["tsconfig.json", "jsconfig.json"]
   */
  configNames?: string[]
}

export interface TSConfig {
  include?: string[]
  exclude?: string[]
  compilerOptions?: {
    baseUrl?: string
    paths?: { [path: string]: string[] }
    allowJs?: boolean
    checkJs?: boolean
    outDir?: string
  }
}
