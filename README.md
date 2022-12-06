👋 Do you like **Postgres** 🐘? I'm making a [100% type-safe query builder](https://github.com/alloc/tusken) (not an ORM), and **I want your help** fleshing it out.  
<sub>
   Btw, it generates the types and client from your database schema, so it's never out-of-date and you have access to [every native Postgres function](https://github.com/alloc/tusken/blob/master/spec/generated/test/functions.ts)!  
   I want to add a [powerful plugin system](https://github.com/alloc/tusken/issues/11) soon, and eventually all functionality will be pluggable.
</sub>

[**Learn more**](https://github.com/alloc/tusken)  

---

# vite-tsconfig-paths

[![npm](https://img.shields.io/npm/v/vite-tsconfig-paths.svg)](https://www.npmjs.com/package/vite-tsconfig-paths)
[![codecov](https://codecov.io/gh/aleclarson/vite-tsconfig-paths/branch/master/graph/badge.svg)](https://codecov.io/gh/aleclarson/vite-tsconfig-paths)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://paypal.me/alecdotbiz)

Give [`vite`] the ability to resolve imports using TypeScript's path mapping.

[`vite`]: https://github.com/vitejs/vite

## Usage

1. Install as dev dependency

   ```sh
   # npm
   npm install --save-dev vite-tsconfig-paths

   # yarn
   yarn add -D vite-tsconfig-paths

   # pnpm
   pnpm add -D vite-tsconfig-paths
   ```

2. Inject `vite-tsconfig-paths` using the `vite.config.ts` module

   ```ts
   import { defineConfig } from 'vite'
   import tsconfigPaths from 'vite-tsconfig-paths'

   export default defineConfig({
     plugins: [tsconfigPaths()],
   })
   ```

**Note:** You need to restart Vite when you update your `paths` mappings.

### Options

- `root: string`  
  The directory to crawl for `tsconfig.json` files.  
  Defaults to `viteConfig.root`

- `projects: string[]`  
  An array of `tsconfig.json` paths (relative to `viteConfig.root`)
  and/or directories that contain a `tsconfig.json` file.  
  This overrides the `root` option.

- `extensions: string[]`  
  File extensions to search for.  
  Defaults to `.ts | .tsx | .js | .jsx | .mjs`

- `loose: boolean`  
  Disable strictness that limits path resolution to TypeScript and JavaScript modules.  
  Useful if you want asset URLs in Vue templates to be resolved.

&nbsp;

### allowJs

If your `tsconfig.json` file has `"allowJs": true` in it, path resolution will be expanded beyond TypeScript modules. The following extensions will have their imports resolved by this plugin: `.vue`, `.svelte`, `.mdx`, `.mjs`, `.js`, `.jsx`

&nbsp;

### baseUrl

If the `baseUrl` is defined, it gets prepended to all bare imports, and its resolution will take precedence over node_modules. This is also how TypeScript does it.

Say the `baseUrl` is `../root` and you import `react`. This plugin will use `../root/react` if it exists. If not found, then `react` is resolved normally. The `baseUrl` is relative to the project root (where `tsconfig.json` lives).

&nbsp;

### include/exclude

The `include` and `exclude` compiler options are respected.

Internally, [globrex](https://github.com/terkelg/globrex) is used for glob matching.

&nbsp;

### Troubleshooting

The `DEBUG` environment variable can be used to figure out why this plugin isn't working as you may have expected.

```sh
DEBUG=vite-tsconfig-paths yarn vite
```

Also, check out the [Troubleshooting](https://github.com/aleclarson/vite-tsconfig-paths/wiki/Troubleshooting) wiki page for more guidance.
