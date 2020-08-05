import { relative } from 'path'
import { createMatchPath, loadConfig } from 'tsconfig-paths'
import { mainFields, supportedExts, Resolver } from 'vite/dist/node/resolver'

let resolver: Resolver = {}

const config = loadConfig()
if (config.resultType == 'failed') {
  console.warn('[vite-tsconfig-paths]', config.message)
} else if (config.paths) {
  const matchPath = createMatchPath(
    config.absoluteBaseUrl,
    config.paths,
    config.mainFields || mainFields,
    config.addMatchAll
  )
  resolver = {
    alias(id) {
      let path = matchPath(id, undefined, undefined, supportedExts)
      return path ? '/' + relative(process.cwd(), path) : undefined
    },
  }
}

export default resolver
