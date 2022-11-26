import { resolve } from 'path'

export type PathMapping = {
  pattern: RegExp
  paths: string[]
}

export function resolvePathMappings(
  paths: Record<string, string[]>,
  root: string
) {
  // If a module name can be matched with multiple patterns then pattern
  // with the longest prefix will be picked.
  const sortedPatterns = Object.keys(paths).sort(
    (a: string, b: string) => getPrefixLength(b) - getPrefixLength(a)
  )
  const resolved: PathMapping[] = []
  for (let pattern of sortedPatterns) {
    const relativePaths = paths[pattern]
    pattern = escapeStringRegexp(pattern).replace(/\*/g, '(.+)')
    resolved.push({
      pattern: new RegExp('^' + pattern + '$'),
      paths: relativePaths.map((relativePath) => resolve(root, relativePath)),
    })
  }
  return resolved
}

function getPrefixLength(pattern: string): number {
  const prefixLength = pattern.indexOf('*')
  return pattern.substr(0, prefixLength).length
}

// Adapted from:
// https://github.com/sindresorhus/escape-string-regexp/blob/ba9a4473850cb367936417e97f1f2191b7cc67dd/index.js
//
// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://*
// sindresorhus.com)
//
// Permission is hereby granted, free of charge, to any person *
// obtaining a copy of this software and associated documentation *
// files (the "Software"), to deal in the Software without *
// restriction, including without limitation the rights to use, * copy,
// modify, merge, publish, distribute, sublicense, and/or * sell copies
// of the Software, and to permit persons to whom the * Software is
// furnished to do so, subject to the following * conditions:
//
// The above copyright notice and this permission notice shall be *
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
// BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
// ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
// CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//
function escapeStringRegexp(string: string) {
  // Escape characters with special meaning either inside or outside
  // character sets. Use a simple backslash escape when it’s always
  // valid, and a `\xnn` escape when the simpler form would be
  // disallowed by Unicode patterns’ stricter grammar.
  return string.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/-/g, '\\x2d')
}
