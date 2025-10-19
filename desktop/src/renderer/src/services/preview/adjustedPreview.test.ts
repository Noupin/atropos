import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureCspAndElectronAllowLocalMedia,
  prepareWindowedPlayback,
  resolveOriginalSource
} from './adjustedPreview'

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

class MockVideoElement extends EventTarget {
  currentTime = 0
  duration = Number.NaN
  readyState = 0
  paused = true
  ended = false
  error: MediaError | null = null
  play = vi.fn<[], Promise<void>>().mockResolvedValue(undefined)
  pause = vi.fn().mockImplementation(() => {
    this.paused = true
  })
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

  it('waits for metadata before seeking and resumes playback afterwards', async () => {
    const video = new MockVideoElement()
    const statusChanges: string[] = []
    const controller = prepareWindowedPlayback(video as unknown as HTMLVideoElement, {
      start: 5,
      end: 10,
      onStatusChange: (status) => statusChanges.push(status)
    })

    expect(statusChanges).toContain('loading')

    video.dispatchEvent(new Event('play'))
    expect(video.pause).toHaveBeenCalled()

    video.readyState = 1
    video.duration = 60
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBeCloseTo(5)

    video.dispatchEvent(new Event('seeked'))
    await Promise.resolve()
    expect(video.play).toHaveBeenCalled()

    controller.dispose()
  })

  it('clamps invalid playback windows and reports warnings', () => {
    const video = new MockVideoElement()
    video.readyState = 1
    video.duration = 30
    const warnings: string[] = []
    const controller = prepareWindowedPlayback(video as unknown as HTMLVideoElement, {
      start: 10,
      end: 12,
      onInvalidRange: (warning) => warnings.push(warning.reason)
    })

    controller.updateWindow(20, 15)
    vi.advanceTimersByTime(200)
    expect(warnings).toContain('reversed')
    expect(video.currentTime).toBeLessThanOrEqual(20)
    controller.dispose()
  })

  it('keeps manual scrubbing within the playback window', () => {
    const video = new MockVideoElement()
    const controller = prepareWindowedPlayback(video as unknown as HTMLVideoElement, {
      start: 30,
      end: 40
    })

    video.readyState = 1
    video.duration = 120
    video.dispatchEvent(new Event('loadedmetadata'))
    vi.advanceTimersByTime(200)

    video.currentTime = 90
    video.dispatchEvent(new Event('seeking'))
    expect(video.currentTime).toBeLessThanOrEqual(40)
    expect(video.currentTime).toBeGreaterThan(39.9)

    video.currentTime = 5
    video.dispatchEvent(new Event('seeking'))
    expect(video.currentTime).toBeGreaterThanOrEqual(30)
    expect(video.currentTime).toBeLessThan(30.1)

    controller.dispose()
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

