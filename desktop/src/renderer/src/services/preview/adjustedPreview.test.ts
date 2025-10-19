import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { ensureCspAndElectronAllowLocalMedia, normaliseWindowRange, resolveOriginalSource } from './adjustedPreview'

const buildMockWindow = () => {
  const listeners = new Map<string, (event: Event) => void>()
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', "default-src 'self'; media-src 'self' data: blob:")
  document.head.appendChild(meta)
  return {
    api: {
      resolveProjectSource: vi.fn()
    },
    electron: undefined,
    _meta: meta,
    addEventListener: (event: string, listener: (event: Event) => void) => {
      listeners.set(event, listener)
    },
    removeEventListener: (event: string) => listeners.delete(event)
  }
}

describe('adjustedPreview helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    ;(window as any).api = buildMockWindow().api
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach((meta) => meta.remove())
  })

  it('persists resolved original source paths and prefers them on subsequent lookups', async () => {
    const resolver = vi
      .spyOn(window.api!, 'resolveProjectSource')
      .mockResolvedValueOnce({
        status: 'ok',
        filePath: '/projects/test/video.mp4',
        fileUrl: 'file:///projects/test/video.mp4',
        origin: 'canonical',
        projectDir: '/projects/test',
        mediaToken: 'token-1'
      })
      .mockResolvedValueOnce({
        status: 'ok',
        filePath: '/projects/test/video.mp4',
        fileUrl: 'file:///projects/test/video.mp4',
        origin: 'preferred',
        projectDir: '/projects/test',
        mediaToken: 'token-2'
      })

    const first = await resolveOriginalSource({
      clipId: 'clip-1',
      projectId: 'project-1',
      accountId: null,
      playbackUrl: 'file:///projects/test/shorts/clip.mp4'
    })
    expect(first.kind).toBe('ready')
    if (first.kind === 'ready') {
      expect(first.mediaUrl).toBe('app://local-media/token-1')
    }
    expect(resolver).toHaveBeenCalledWith({
      clipId: 'clip-1',
      projectId: 'project-1',
      accountId: null,
      preferredPath: null
    })

    const stored = window.localStorage.getItem('atropos.adjustedPreview.originalSources')
    expect(stored).toContain('/projects/test/video.mp4')

    const second = await resolveOriginalSource({
      clipId: 'clip-1',
      projectId: 'project-1',
      accountId: null,
      playbackUrl: 'file:///projects/test/shorts/clip.mp4'
    })
    expect(second.kind).toBe('ready')
    if (second.kind === 'ready') {
      expect(second.mediaUrl).toBe('app://local-media/token-2')
    }
    expect(resolver).toHaveBeenLastCalledWith({
      clipId: 'clip-1',
      projectId: 'project-1',
      accountId: null,
      preferredPath: '/projects/test/video.mp4'
    })
  })

  it('rejects rendered short sources for adjusted preview', async () => {
    vi.spyOn(window.api!, 'resolveProjectSource').mockResolvedValue({
      status: 'ok',
      filePath: '/projects/test/shorts/clip.mp4',
      fileUrl: 'file:///projects/test/shorts/clip.mp4',
      origin: 'discovered',
      projectDir: '/projects/test',
      mediaToken: 'token-3'
    })

    const result = await resolveOriginalSource({
      clipId: 'clip-2',
      projectId: 'project-2',
      accountId: null,
      playbackUrl: 'file:///projects/test/shorts/clip.mp4'
    })

    expect(result.kind).toBe('error')
  })

  it('falls back to the file URL when no media token is provided', async () => {
    vi.spyOn(window.api!, 'resolveProjectSource').mockResolvedValue({
      status: 'ok',
      filePath: '/projects/test/video.mp4',
      fileUrl: 'file:///projects/test/video.mp4',
      origin: 'canonical',
      projectDir: '/projects/test',
      mediaToken: null
    })

    const result = await resolveOriginalSource({
      clipId: 'clip-3',
      projectId: 'project-3',
      accountId: null,
      playbackUrl: 'file:///projects/test/shorts/clip.mp4'
    })

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(result.mediaUrl).toBe('file:///projects/test/video.mp4')
    }
  })

  it('normalises playback windows and reports warnings', () => {
    const basic = normaliseWindowRange(5, 10, { duration: 60 })
    expect(basic.range.start).toBeCloseTo(5)
    expect(basic.range.end).toBeCloseTo(10)
    expect(basic.warning).toBeNull()

    const reversed = normaliseWindowRange(12, 8, { duration: 30 })
    expect(reversed.range.start).toBeCloseTo(12)
    expect(reversed.range.end).toBeGreaterThan(reversed.range.start)
    expect(reversed.warning?.reason).toBe('reversed')

    const outOfBounds = normaliseWindowRange(28, 40, { duration: 30 })
    expect(outOfBounds.range.start).toBeLessThanOrEqual(30)
    expect(outOfBounds.range.end).toBeCloseTo(30)
    expect(outOfBounds.warning?.reason).toBe('out_of_bounds')
  })

  it('adds file:// and app:// to the CSP media-src directive when missing', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('http-equiv', 'Content-Security-Policy')
    meta.setAttribute('content', "default-src 'self'; media-src 'self' data: blob:")
    document.head.appendChild(meta)

    ensureCspAndElectronAllowLocalMedia()

    const updated = meta.getAttribute('content')
    expect(updated).toContain('file:')
    expect(updated).toContain('app:')
  })
})

