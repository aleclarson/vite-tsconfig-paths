import { createDebug, enable, type Debugger } from 'obug'

export const debug: Debugger = createDebug('vite-tsconfig-paths')

if (process.env.TEST === 'vite-tsconfig-paths') {
  enable('vite-tsconfig-paths')
}
