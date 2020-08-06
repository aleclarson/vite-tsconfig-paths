# vite-tsconfig-paths

[![npm](https://img.shields.io/npm/v/vite-tsconfig-paths.svg)](https://www.npmjs.com/package/vite-tsconfig-paths)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)
[![Donate](https://img.shields.io/badge/Donate-PayPal-green.svg)](https://paypal.me/alecdotbiz)

Give [`vite`] the ability to resolve imports using TypeScript's path mapping.

[`vite`]: https://github.com/vitejs/vite

## Usage

1. Install as dev dependency

2. Inject `vite-tsconfig-paths` using the `vite.config.ts` module

    ```ts
    import type { UserConfig } from 'vite'
    import tsResolver from 'vite-tsconfig-paths'

    const config: UserConfig = {
      resolvers: [tsResolver],
    }

    export default config
    ```

**Note:** You need to restart Vite when you update your `paths` mappings.

&nbsp;

## Donate

If this package helps you, please donate! Any amount is greatly appreciated. 🥰

- ETH: **0xa446626195bbe4d0697e729c1433a86fB6Cf66cF**
- BTC: **17vYtAUPKXzubMEnNcN8SiuFgicrd5Rp9A**
- KIN: **GBU7RDRD7VDVT254RR6PGMBJESXQVDHJ5CGGODZKRXM2P4MP3G5QSAMH**
