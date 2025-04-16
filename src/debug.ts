import createDebug from 'debug'

export const debug = createDebug('vite-tsconfig-paths')
export const debugResolve = createDebug('vite-tsconfig-paths:resolve')

if (process.env.TEST === 'vite-tsconfig-paths') {
  createDebug.log = console.log.bind(console)
}
