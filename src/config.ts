import { readdir } from 'node:fs/promises'
import { readTsconfig } from 'get-tsconfig'
import type { NormalizedPath } from './path'
import * as path from './path'
import type { Project } from './types'

export function loadProjectGraph(tsconfigFile: string): Project {
  const projects = new Map<NormalizedPath, Project>()

  const load = (file: string): Project => {
    const normalizedFile = path.normalize(file)
    const existing = projects.get(normalizedFile)
    if (existing) {
      return existing
    }

    const result = readTsconfig(normalizedFile, {
      // The plugin must not inspect or load the project's TypeScript package.
      typescriptVersion: false,
    })
    const project: Project = {
      tsconfigFile: path.normalize(result.path),
      tsconfig: result.config,
      sourcePaths: (result.sources ?? [result.path]).map(path.normalize),
    }
    projects.set(project.tsconfigFile, project)

    if (result.config.references?.length) {
      const configDir = path.dirname(project.tsconfigFile)
      project.referenced = result.config.references.map((reference) => {
        let referencePath = reference.path
        if (!referencePath.endsWith('.json')) {
          referencePath = path.join(
            path.normalize(referencePath),
            'tsconfig.json' as NormalizedPath
          )
        }
        return load(path.resolve(configDir, referencePath))
      })
    }

    return project
  }

  return load(tsconfigFile)
}

export async function findAllProjects(
  root: string,
  configNames: readonly string[],
  skip: (dir: string) => boolean
): Promise<NormalizedPath[]> {
  const projects: NormalizedPath[] = []

  const walk = async (dir: NormalizedPath): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error: any) {
      if (
        error.code === 'ENOENT' ||
        error.code === 'EACCES' ||
        error.code === 'EPERM'
      ) {
        return
      }
      throw error
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.isDirectory() && !skip(entry.name)) {
          await walk(path.join(dir, path.normalize(entry.name)))
        } else if (entry.isFile() && configNames.includes(entry.name)) {
          projects.push(path.join(dir, path.normalize(entry.name)))
        }
      })
    )
  }

  await walk(path.resolve(root))
  projects.sort((left, right) => left.localeCompare(right))
  return projects
}
