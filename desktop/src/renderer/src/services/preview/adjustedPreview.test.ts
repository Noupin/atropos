import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  ensureCspAndElectronAllowLocalMedia,
  resolveOriginalSource,
  buildTrimmedPreviewSource,
  attachTrimmedPlaybackGuards,
  clampPlaybackWindow
} from './adjustedPreview'

const buildMockWindow = () => {
  const listeners = new Map<string, (event: Event) => void>()
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', "default-src 'self'; media-src 'self' data: blob:")
  document.head.appendChild(meta)
  return {
    api: {
      resolveProjectSource: vi.fn(),
      buildTrimmedPreview: vi.fn(),
      releaseMediaToken: vi.fn()
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


  it('clamps playback windows to a safe range', () => {
    const reversed = clampPlaybackWindow(20, 18)
    expect(reversed.applied.start).toBeCloseTo(20)
    expect(reversed.applied.end).toBeGreaterThan(20)
    expect(reversed.warning?.reason).toBe('reversed')

    const bounded = clampPlaybackWindow(-5, 1)
    expect(bounded.applied.start).toBe(0)
    expect(bounded.applied.end).toBeGreaterThan(0)
    expect(bounded.warning?.reason).toBe('out_of_bounds')
  })

  it('builds trimmed preview sources using the Electron bridge', async () => {
    vi.spyOn(window.api!, 'buildTrimmedPreview').mockResolvedValue({
      status: 'ok',
      mediaToken: 'trim-token',
      duration: 14,
      strategy: 'ffmpeg',
      outputPath: '/tmp/preview.mp4'
    })

    const result = await buildTrimmedPreviewSource({
      filePath: '/projects/test/video.mp4',
      start: 300,
      end: 314
    })

    expect(window.api!.buildTrimmedPreview).toHaveBeenCalledWith({
      filePath: '/projects/test/video.mp4',
      start: 300,
      end: 314
    })

    expect(result.kind).toBe('ready')
    if (result.kind === 'ready') {
      expect(result.url).toBe('app://local-media/trim-token')
      expect(result.duration).toBeCloseTo(14)
      expect(result.applied.start).toBeCloseTo(300)
      expect(result.applied.end).toBeCloseTo(314)
    }
  })

  it('reports errors when trimmed preview generation fails', async () => {
    vi.spyOn(window.api!, 'buildTrimmedPreview').mockRejectedValue(new Error('ffmpeg missing'))

    const result = await buildTrimmedPreviewSource({
      filePath: '/projects/test/video.mp4',
      start: 0,
      end: 5
    })

    expect(result.kind).toBe('error')
  })

  it('enforces playback duration with trimmed guards', () => {
    const video = new MockVideoElement()
    video.readyState = 1
    video.duration = 14
    const onEnded = vi.fn()

    const guards = attachTrimmedPlaybackGuards(video as unknown as HTMLVideoElement, {
      duration: 14,
      onEnded
    })

    video.currentTime = 5
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.currentTime).toBeCloseTo(0)

    video.currentTime = 13.99
    video.paused = false
    video.dispatchEvent(new Event('timeupdate'))
    expect(video.pause).toHaveBeenCalled()
    expect(video.currentTime).toBeCloseTo(14)
    expect(onEnded).toHaveBeenCalled()

    video.dispatchEvent(new Event('ended'))
    expect(video.currentTime).toBeCloseTo(14)

    guards.dispose()
  })
})
