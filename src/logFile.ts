import { createWriteStream, writeFileSync } from 'fs'

type ImportDetails = { importer: string | undefined; id: string }
type ConfigDetails = ImportDetails & { configPath: string }
type ResolveDetails = ConfigDetails & { resolvedId: string }
type NotFoundDetails = ConfigDetails & { candidates: string[] | null }

export type LogEvent =
  | ['emptyImporter', ImportDetails]
  | ['virtualImporter', ImportDetails]
  | ['unsupportedExtension', ImportDetails]
  | ['relativeId', ImportDetails]
  | ['absoluteId', ImportDetails]
  | ['virtualId', ImportDetails]
  | ['resolvedWithBaseUrl', ResolveDetails]
  | ['resolvedWithPaths', ResolveDetails]
  | ['notFound', NotFoundDetails]
  | ['configMismatch', ConfigDetails]

/**
 * This log file is dedicated to the resolution process. Other debug logs
 * will appear in the console if you set `DEBUG=vite-tsconfig-paths` in
 * your shell environment.
 */
export function createLogFile(logFilePath: string) {
  writeFileSync(logFilePath, '')
  const logFile = createWriteStream(logFilePath, {
    flags: 'a',
    encoding: 'utf-8',
  })

  return {
    write(...event: LogEvent) {
      logFile.write(event[0] + ': ' + JSON.stringify(event[1]) + '\n')
    },
  }
}
