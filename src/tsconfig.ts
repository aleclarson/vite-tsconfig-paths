import * as fs from 'node:fs'
import { readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { parseTsconfig, type TsConfigJsonResolved } from 'get-tsconfig'
import type { ParsedCommandLine } from 'typescript'
import * as path from './path'
import type { NormalizedPath } from './path'

export type Project = {
  extended?: Project[]
  referenced?: Project[]
  result?: ParsedCommandLine
  tsconfig: TsConfigJsonResolved
  tsconfigFile: NormalizedPath
}

type FindAllOptions = {
  configNames: string[]
  skip: (dir: string) => boolean
}

type RawTsconfig = {
  extends?: string
}

const require = createRequire(import.meta.url)

export async function parse(tsconfigFile: string): Promise<Project> {
  return parseProject(tsconfigFile, false, new Map())
}

export async function parseNative(tsconfigFile: string): Promise<Project> {
  return parseProject(tsconfigFile, true, new Map())
}

export async function findAll(
  root: string,
  { configNames, skip }: FindAllOptions
): Promise<string[]> {
  const found = new Set<string>()

  await visit(path.normalize(root))
  return Array.from(found).sort((left, right) => left.localeCompare(right))

  async function visit(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        const file = path.normalize(join(dir, entry.name))
        if (entry.isDirectory()) {
          if (!skip(entry.name)) {
            await visit(file)
          }
          return
        }
        if (entry.isFile() && configNames.includes(entry.name)) {
          found.add(file)
        }
      })
    )
  }
}

async function parseProject(
  tsconfigFile: string,
  loadNativeResult: boolean,
  cache: Map<string, Project>
): Promise<Project> {
  tsconfigFile = path.normalize(resolve(tsconfigFile))

  let project = cache.get(tsconfigFile)
  if (!project) {
    project = {
      tsconfigFile: tsconfigFile as NormalizedPath,
      tsconfig: parseTsconfig(tsconfigFile),
    }
    cache.set(tsconfigFile, project)
    await populateProject(project, loadNativeResult, cache)
  }
  return project
}

async function populateProject(
  project: Project,
  loadNativeResult: boolean,
  cache: Map<string, Project>
): Promise<void> {
  const tsconfigFile = project.tsconfigFile
  const rawConfig = readRawTsconfig(tsconfigFile)
  if (rawConfig.extends) {
    project.extended = [
      await parseProject(
        resolveExtendsPath(rawConfig.extends, dirname(tsconfigFile)),
        loadNativeResult,
        cache
      ),
    ]
  }

  if (project.tsconfig.references?.length) {
    project.referenced = await Promise.all(
      project.tsconfig.references
        .map((reference) => reference.path)
        .filter((referencePath): referencePath is string => !!referencePath)
        .map((referencePath) =>
          parseProject(
            resolveReferencePath(referencePath, dirname(tsconfigFile)),
            loadNativeResult,
            cache
          )
        )
    )
  }

  if (loadNativeResult) {
    project.result = await loadParsedCommandLine(tsconfigFile)
  }
}

async function loadParsedCommandLine(
  tsconfigFile: string
): Promise<ParsedCommandLine> {
  const ts = require('typescript') as typeof import('typescript')
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfigFile,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(
          ts.formatDiagnosticsWithColorAndContext([diagnostic], {
            getCanonicalFileName: (fileName) => fileName,
            getCurrentDirectory: () => process.cwd(),
            getNewLine: () => '\n',
          })
        )
      },
    }
  )

  if (!parsed) {
    throw new Error(`Failed to parse tsconfig at ${tsconfigFile}`)
  }
  return parsed
}

function readRawTsconfig(tsconfigFile: string): RawTsconfig {
  const text = fs.readFileSync(tsconfigFile, 'utf8')
  const json = parseJsonc(text)
  return json && typeof json === 'object' ? (json as RawTsconfig) : {}
}

function parseJsonc(text: string): unknown {
  let output = ''
  let index = 0
  let inString = false

  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]

    if (inString) {
      output += char
      if (char === '\\') {
        output += next
        index += 2
        continue
      }
      if (char === '"') {
        inString = false
      }
      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      output += char
      index += 1
      continue
    }

    if (char === '/' && next === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') {
        index += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length) {
        if (text[index] === '*' && text[index + 1] === '/') {
          index += 2
          break
        }
        index += 1
      }
      continue
    }

    output += char
    index += 1
  }

  return JSON.parse(output.replace(/,\s*([}\]])/g, '$1'))
}

function resolveReferencePath(referencePath: string, fromDir: string): string {
  const resolved = resolve(fromDir, referencePath)
  return path.normalize(
    resolved.endsWith('.json') ? resolved : join(resolved, 'tsconfig.json')
  )
}

function resolveExtendsPath(extendsPath: string, fromDir: string): string {
  if (extendsPath.startsWith('.')) {
    return resolveConfigPath(resolve(fromDir, extendsPath))
  }
  if (isAbsolute(extendsPath)) {
    return resolveConfigPath(extendsPath)
  }
  return path.normalize(require.resolve(extendsPath, { paths: [fromDir] }))
}

function resolveConfigPath(file: string): string {
  if (file.endsWith('.json')) {
    return path.normalize(file)
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    return path.normalize(join(file, 'tsconfig.json'))
  }
  const withJsonExtension = `${file}.json`
  if (fs.existsSync(withJsonExtension)) {
    return path.normalize(withJsonExtension)
  }
  return path.normalize(file)
}
