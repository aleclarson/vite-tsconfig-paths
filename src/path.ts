import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vite from 'vite'

const isWindows = os.platform() == 'win32'

export type NormalizedPath = string & { __normalized: true }

export const normalize = (p: string): NormalizedPath => {
  let output = vite.normalizePath(p)
  // Normalize the drive letter casing on Windows to upper case,
  if (isWindows && output[1] === ':') {
    output = output[0].toUpperCase() + output.substring(1)
  }
  return output as NormalizedPath
}

export const parse = (p: NormalizedPath): { root: NormalizedPath } => {
  const parsed = path.parse(p)
  return { root: parsed.root as NormalizedPath }
}

export const resolve = (...paths: string[]): NormalizedPath =>
  isWindows
    ? normalize(path.win32.resolve(...paths))
    : (path.posix.resolve(...paths) as NormalizedPath)

export const isAbsolute: (p: string) => boolean = isWindows
  ? path.win32.isAbsolute
  : path.posix.isAbsolute

/** Only call this on normalized paths */
export const join = (...paths: NormalizedPath[]): NormalizedPath =>
  path.posix.join(...paths) as NormalizedPath

/** Only call this on normalized paths */
export const relative = (
  from: NormalizedPath,
  to: NormalizedPath
): NormalizedPath => path.posix.relative(from, to) as NormalizedPath

/** Only call this on normalized paths */
export const basename = (p: NormalizedPath, suffix?: string): NormalizedPath =>
  path.posix.basename(p, suffix) as NormalizedPath

/** Only call this on normalized paths */
export const dirname = (p: NormalizedPath): NormalizedPath =>
  path.dirname(p) as NormalizedPath

/** Resolve symlinks and normalize. Falls back to normalize on error. */
export const realpath = (p: string): NormalizedPath => {
  try {
    return normalize(fs.realpathSync(p))
  } catch {
    return normalize(p)
  }
}

export const relativeImportRE: RegExp = /^\.\.?(\/|$)/
