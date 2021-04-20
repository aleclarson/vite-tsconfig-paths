import { resetConfigs, loadConfig, configs } from './mocks'
import { resolve } from '../src/path'

const isWindows = 'win32' == jest.requireActual('os').platform()

function winify(path: string) {
  return isWindows ? resolve(path) : 'D:' + path
}

beforeEach(() => {
  resetConfigs()
  loadConfig.mockImplementation((cwd) => {
    const expectsPosix = cwd[0] == '/'
    if (!expectsPosix) {
      cwd = cwd.slice(2) // convert D:/ to /
    }
    const config = configs[cwd]
    if (!expectsPosix && config?.configPath[0] == '/') {
      config.configPath = winify(config.configPath)
      config.baseUrl = config.baseUrl && winify(config.baseUrl)
    }
    return config
  })
})

afterEach(() => {
  jest.resetAllMocks()
})
