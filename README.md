👋 Check out [Radashi](https://github.com/radashi-org/radashi), my latest endeavor.

<a href="https://github.com/radashi-org/radashi"><img src="https://github.com/radashi-org/radashi/raw/main/.github/img/notice.png" alt="Radashi" width="100%" /></a>

---

&nbsp;

# vite-tsconfig-paths

[![npm](https://img.shields.io/npm/v/vite-tsconfig-paths.svg)](https://www.npmjs.com/package/vite-tsconfig-paths)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Give [`vite`] the ability to resolve imports using TypeScript's path mapping.

[`vite`]: https://github.com/vitejs/vite

## Usage

1. Install as dev dependency

2. Ensure the project either has `"type": "module"` set or that the Vite config is renamed to `vite.config.mjs` / `vite.config.mts` depending on whether TypeScript is used

3. Inject `vite-tsconfig-paths` in the Vite config

   ```ts
   import { defineConfig } from 'vite'
   import tsconfigPaths from 'vite-tsconfig-paths'

   export default defineConfig({
     plugins: [tsconfigPaths()],
   })
   ```

4. (optional) ⚠️ To enable path resolution in non-TypeScript modules (e.g. `.vue`, `.svelte`, `.mdx`), you must set the `allowJs` option to true in your `tsconfig.json` file. If that doesn't work, you might need to enable `loose: true` to resolve all files. Note that, due to a Vite limitation, CSS files (and CSS dialects) cannot be resolved with this plugin (see [#30](https://github.com/aleclarson/vite-tsconfig-paths/issues/30)).

**Note:** You need to restart Vite when you update your `paths` mappings. This is being tracked in [#17](https://github.com/aleclarson/vite-tsconfig-paths/issues/17) (contributions welcome).

### Options

- `root: string`  
  The directory to search for `tsconfig.json` files.

  The default value of this option depends on whether `projects` is defined. If it is, then the [Vite project root](https://vitejs.dev/config/shared-options.html#root) is used. Otherwise, Vite's [`searchForWorkspaceRoot`](https://vitejs.dev/guide/api-javascript.html#searchforworkspaceroot) function is used.

- `projects: string[]`  
  If you have an esoteric setup, you _might_ need this option to specify where your tsconfig files are located. The paths within are relative to the `root` option.

  If defined, the `root` directory won't be searched for tsconfig files. You should **always** try using just the `root` option first, because this option is more brittle.

- `loose: boolean`  
  Disable strictness that limits path resolution to TypeScript and JavaScript importers.

  Useful if you want imports in Vue templates to be resolved, but don't want to use `allowJs` in your tsconfig, for example.

  In other words, when `loose: true` is used, any file that gets transpiled into JavaScript will have its imports resolved by this plugin.

- `parseNative: boolean`  
  Enable use of the [`tsconfck.parseNative`](https://github.com/dominikg/tsconfck/blob/main/docs/api.md#parsenative) function, which delegates the loading of tsconfig files to the TypeScript compiler. You'll probably never need this, but I added it just in case.

  ⚠️ This option can slow down Vite's startup time by as much as
  600ms, due to the size of the TypeScript compiler. Only use it when
  necessary.

- `ignoreConfigErrors: boolean`  
  When true, parsing errors encountered while loading tsconfig files will be ignored. This is useful if you have a monorepo with multiple tsconfig files, and you don't want to see errors for the ones that aren't relevant to the current project.

- `skip: (dir: string) => boolean`  
  A function that determines which directories to skip when searching for tsconfig.json files. While `.git` and `node_modules` directories are always skipped, this option allows you to skip additional directories, which is useful in large monorepos to improve performance.

&nbsp;

### allowJs

If your tsconfig file has `"allowJs": true` in it, path resolution will be expanded beyond TypeScript importers. The following extensions will have their imports resolved by this plugin: `.vue`, `.svelte`, `.mdx`, `.mjs`, `.js`, `.jsx`

&nbsp;

### baseUrl

If the `baseUrl` is defined, it gets prepended to all bare imports, and its resolution will take precedence over node_modules. This is also how TypeScript does it.

Say the `baseUrl` is `../root` and you import `react`. This plugin will use `../root/react` if it exists. If not found, then `react` is resolved normally. The `baseUrl` is relative to the project root (where `tsconfig.json` lives).

&nbsp;

### include/exclude

The `include` and `exclude` tsconfig options are respected.

Internally, [globrex](https://github.com/terkelg/globrex) is used for glob matching.

&nbsp;

### Troubleshooting

The `DEBUG` environment variable can be used to figure out why this plugin isn't working as you may have expected.

```sh
DEBUG=vite-tsconfig-paths yarn vite
```

Also, check out the [Troubleshooting](https://github.com/aleclarson/vite-tsconfig-paths/wiki/Troubleshooting) wiki page for more guidance.
