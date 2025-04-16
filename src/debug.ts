import createDebug from 'debug'

export const debug = createDebug('vite-tsconfig-paths')

if (process.env.TEST === 'vite-tsconfig-paths') {
  createDebug.log = console.log.bind(console)
}
