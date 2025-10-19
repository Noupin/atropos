// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import type { ResolveProjectSourceRequest } from '../../../types/preview'

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const encodeProjectId = (baseDir: string, projectDir: string): string => {
  const relative = path.relative(baseDir, projectDir).split(path.sep).join('/')
  return toBase64Url(relative)
}

let tempRoot: string

const createTempRoot = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atropos-adjusted-preview-'))
  return dir
}

const cleanupTempRoot = async (dir: string | null | undefined): Promise<void> => {
  if (!dir) {
    return
  }
  await fs.rm(dir, { recursive: true, force: true })
}

describe('resolveProjectSourceVideo media resolution', () => {
  beforeEach(async () => {
    vi.resetModules()
    tempRoot = await createTempRoot()
    process.env.OUT_ROOT = tempRoot
  })

  afterEach(async () => {
    await cleanupTempRoot(tempRoot)
    delete process.env.OUT_ROOT
  })

  it('prefers the canonical project source even when stored as a .mov file', async () => {
    const { resolveProjectSourceVideo } = await import('../../../main/clipLibrary')
    const accountDir = path.join(tempRoot, 'account-one')
    const projectDir = path.join(accountDir, 'project-alpha')
    const shortsDir = path.join(projectDir, 'shorts')
    await fs.mkdir(shortsDir, { recursive: true })

    const canonicalMov = path.join(projectDir, 'project-alpha.mov')
    const renderedShort = path.join(shortsDir, 'project-alpha-short.mp4')

    await fs.writeFile(canonicalMov, Buffer.alloc(16, 1))
    await fs.writeFile(renderedShort, Buffer.alloc(4, 2))

    const request: ResolveProjectSourceRequest = {
      projectId: encodeProjectId(tempRoot, projectDir),
      clipId: null,
      accountId: null,
      preferredPath: null
    }

    const result = await resolveProjectSourceVideo(request)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') {
      return
    }
    expect(result.filePath).toBe(canonicalMov)
    expect(result.origin).toBe('canonical')
  })

  it('falls back to the largest discovered source when canonical files are missing', async () => {
    const { resolveProjectSourceVideo } = await import('../../../main/clipLibrary')
    const projectDir = path.join(tempRoot, 'project-beta')
    await fs.mkdir(projectDir, { recursive: true })

    const smallCandidate = path.join(projectDir, 'clip-snippet.mp4')
    const largeCandidate = path.join(projectDir, 'full-session.mkv')

    await fs.writeFile(smallCandidate, Buffer.alloc(8, 3))
    await fs.writeFile(largeCandidate, Buffer.alloc(64, 4))

    const request: ResolveProjectSourceRequest = {
      projectId: encodeProjectId(tempRoot, projectDir),
      clipId: null,
      accountId: null,
      preferredPath: null
    }

    const result = await resolveProjectSourceVideo(request)

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') {
      return
    }
    expect(result.filePath).toBe(largeCandidate)
    expect(result.origin).toBe('discovered')
  })
})
