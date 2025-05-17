import { isFsCaseSensitive } from 'is-fs-case-sensitive'

const caseSensitive = isFsCaseSensitive()

export function fixFilePathCasing(filePath: string) {
  return caseSensitive ? filePath : filePath.toLowerCase()
}

export function includesFilePath(array: string[], filePath: string) {
  return array.includes(fixFilePathCasing(filePath))
}

export class FilePathMap<T> {
  private map = new Map<string, T>()

  get(filePath: string) {
    return this.map.get(fixFilePathCasing(filePath))
  }

  set(filePath: string, value: T) {
    return this.map.set(fixFilePathCasing(filePath), value)
  }

  values() {
    return this.map.values()
  }
}
