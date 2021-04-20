import { createMatchPathAsync, loadConfig } from './mocks'

jest.mock('tsconfig-paths', () => ({
  createMatchPathAsync,
}))

jest.mock('../src/config', () => ({
  loadConfig,
}))
