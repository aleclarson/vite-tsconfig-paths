import { createMatchPathAsync, loadConfig } from './mocks'

jest.mock('tsconfig-paths', () => ({
  createMatchPathAsync,
}))

jest.mock('../src/config', () => ({
  loadConfig,
}))

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  // Since the "path.win32" module supports both /^\// and /^[A-Z]:[\\/]/
  // path formats, we can use it to test windows-style paths without
  // breaking the tests for posix-style paths.
  platform: () => 'win32',
}))
