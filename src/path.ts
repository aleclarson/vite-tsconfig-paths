import * as os from 'os'
import * as path from 'path'
import * as vite from 'vite'

const isWindows = os.platform() == 'win32'

export type NormalizedPath = string & { __normalized: true }

export const normalize = vite.normalizePath as (p: string) => NormalizedPath

export const parse: (p: NormalizedPath) => {
  root: NormalizedPath
} = path.parse as any

export const resolve = isWindows
  ? (...paths: string[]) => normalize(path.win32.resolve(...paths))
  : (path.posix.resolve as (...paths: string[]) => NormalizedPath)

export const isAbsolute = isWindows
  ? path.win32.isAbsolute
  : path.posix.isAbsolute

/** Only call this on normalized paths */
export const join = path.posix.join as (
  ...paths: NormalizedPath[]
) => NormalizedPath

/** Only call this on normalized paths */
export const relative = path.posix.relative as (
  from: NormalizedPath,
  to: NormalizedPath
) => NormalizedPath

/** Only call this on normalized paths */
export const basename = path.posix.basename as (
  path: NormalizedPath,
  suffix?: string
) => NormalizedPath

/** Only call this on normalized paths */
export const dirname = path.dirname as (p: NormalizedPath) => NormalizedPath
