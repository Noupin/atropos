import { createServer } from 'http'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { describe, expect, afterEach, beforeEach, it } from 'vitest'
import { resolveAdjustedSourceUrl } from '../../../main/sourceResolver'
import type { ResolveAdjustedSourceRequest } from '../../../types/adjusted-source'

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf-8')
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

describe('resolveAdjustedSourceUrl', () => {
  const originalOutRoot = process.env.OUT_ROOT
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atropos-test-'))
    process.env.OUT_ROOT = tempRoot
  })

  afterEach(() => {
    process.env.OUT_ROOT = originalOutRoot
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('returns a file URL when the project already contains the full source video', async () => {
    const accountId = 'account-1'
    const projectName = 'project-a'
    const accountDir = path.join(tempRoot, accountId)
    const projectDir = path.join(accountDir, projectName)
    await fs.mkdir(projectDir, { recursive: true })
    const sourcePath = path.join(projectDir, `${projectName}.mp4`)
    writeFileSync(sourcePath, 'local-content')

    const request: ResolveAdjustedSourceRequest = {
      projectId: toBase64Url(`${accountId}/${projectName}`),
      accountId
    }

    const result = await resolveAdjustedSourceUrl(request)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') {
      return
    }
    expect(result.url.startsWith('file://')).toBe(true)
    expect(result.projectRelativePath).toBe(`${accountId}/${projectName}`)
  })

  it('materialises a remote source and returns the local file URL', async () => {
    const accountId = 'account-remote'
    const projectName = 'legacy-project'
    const accountDir = path.join(tempRoot, accountId)
    const projectDir = path.join(accountDir, projectName)
    const shortsDir = path.join(projectDir, 'shorts')
    await fs.mkdir(shortsDir, { recursive: true })
    // Create a dummy clip file so the resolver inspects its description.
    writeFileSync(path.join(shortsDir, 'clip_0-10.mp4'), '')

    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      res.end('downloaded-content')
    })

    await new Promise<void>((resolve) => server.listen(0, resolve))
    const address = server.address()
    if (!address || typeof address !== 'object') {
      server.close()
      throw new Error('Test server did not bind to a port')
    }
    const remoteUrl = `http://127.0.0.1:${address.port}/full.mp4`
    writeFileSync(path.join(shortsDir, 'clip_0-10.txt'), `Full video: ${remoteUrl}`)

    const request: ResolveAdjustedSourceRequest = {
      projectId: toBase64Url(`${accountId}/${projectName}`),
      accountId
    }

    try {
      const result = await resolveAdjustedSourceUrl(request)
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') {
        return
      }
      const destination = path.join(projectDir, `${projectName}.mp4`)
      const content = await fs.readFile(destination, 'utf-8')
      expect(content).toBe('downloaded-content')
      expect(result.url.startsWith('file://')).toBe(true)
    } finally {
      server.close()
    }
  })
})
