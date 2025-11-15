import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolve } from 'path'

const getAppPathMock = vi.fn(() => '/tmp/project/desktop')
const electronProcess = process as NodeJS.Process & { resourcesPath?: string }
const originalResourcesPath = electronProcess.resourcesPath

vi.mock('electron', () => ({
  app: {
    whenReady: vi.fn(async () => Promise.resolve()),
    getAppPath: getAppPathMock,
    getPath: vi.fn(() => '/tmp/project/userData')
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}))

describe('builtin layout resolution', () => {
  beforeEach(() => {
    getAppPathMock.mockReturnValue('/tmp/project/desktop')
    electronProcess.resourcesPath = '/tmp/project/resources'
  })

  afterEach(() => {
    electronProcess.resourcesPath = originalResourcesPath
  })

  it('includes the repository layouts directory when desktop is the app path', async () => {
    const { __testing } = await import('../layouts')
    const candidates = __testing.builtinCandidateDirs()

    expect(candidates).toContain(resolve('/tmp/project/layouts/builtin'))
  })
})
