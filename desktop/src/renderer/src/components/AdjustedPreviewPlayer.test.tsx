import { render, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, beforeAll, afterAll, beforeEach, it, vi } from 'vitest'
import AdjustedPreviewPlayer from './AdjustedPreviewPlayer'

type MediaElement = HTMLVideoElement & {
  __currentTime?: number
  __duration?: number
  __readyState?: number
  __paused?: boolean
}

type OriginalDescriptors = {
  play?: PropertyDescriptor
  pause?: PropertyDescriptor
  currentTime?: PropertyDescriptor
  duration?: PropertyDescriptor
  readyState?: PropertyDescriptor
  paused?: PropertyDescriptor
}

const originalDescriptors: OriginalDescriptors = {}

const installMediaMocks = (): void => {
  if (typeof HTMLMediaElement === 'undefined') {
    throw new Error('HTMLMediaElement is not available in the current test environment')
  }

  Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
    configurable: true,
    get(this: MediaElement) {
      return this.__currentTime ?? 0
    },
    set(this: MediaElement, value: number) {
      this.__currentTime = value
    }
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get(this: MediaElement) {
      return this.__duration ?? 0
    },
    set(this: MediaElement, value: number) {
      this.__duration = value
    }
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', {
    configurable: true,
    get(this: MediaElement) {
      return this.__readyState ?? 4
    },
    set(this: MediaElement, value: number) {
      this.__readyState = value
    }
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: MediaElement) {
      return this.__paused ?? true
    },
    set(this: MediaElement, value: boolean) {
      this.__paused = value
    }
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    writable: true,
    value: vi.fn(function play(this: MediaElement) {
      this.__paused = false
      return Promise.resolve()
    })
  })

  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    writable: true,
    value: vi.fn(function pause(this: MediaElement) {
      this.__paused = true
    })
  })
}

const restoreMediaMocks = (): void => {
  if (typeof HTMLMediaElement === 'undefined') {
    return
  }

  if (originalDescriptors.currentTime) {
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', originalDescriptors.currentTime)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).currentTime
  }

  if (originalDescriptors.duration) {
    Object.defineProperty(HTMLMediaElement.prototype, 'duration', originalDescriptors.duration)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).duration
  }

  if (originalDescriptors.readyState) {
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', originalDescriptors.readyState)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).readyState
  }

  if (originalDescriptors.paused) {
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', originalDescriptors.paused)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).paused
  }

  if (originalDescriptors.play) {
    Object.defineProperty(HTMLMediaElement.prototype, 'play', originalDescriptors.play)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).play
  }

  if (originalDescriptors.pause) {
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', originalDescriptors.pause)
  } else {
    delete (HTMLMediaElement.prototype as MediaElement).pause
  }
}

const renderPlayer = (options: {
  clipStartTime?: number
  clipEndTime?: number
  globalPlayhead?: number
  sourceUrl?: string | null
  isActive?: boolean
}) => {
  let playhead = options.globalPlayhead ?? options.clipStartTime ?? 0
  const handlePlayheadChange = vi.fn((value: number) => {
    playhead = value
  })
  const sharedVolume = { volume: 1, muted: false }
  const handleVolumeChange = vi.fn()
  const handleBufferingChange = vi.fn()

  const { rerender, container } = render(
    <AdjustedPreviewPlayer
      clipStartTime={options.clipStartTime ?? 5}
      clipEndTime={options.clipEndTime ?? 15}
      sourceUrl={options.sourceUrl ?? 'raw-source.mp4'}
      fallbackPreviewUrl="fallback-preview.mp4"
      fallbackPoster="poster.png"
      globalPlayhead={playhead}
      onGlobalPlayheadChange={handlePlayheadChange}
      sharedVolume={sharedVolume}
      onSharedVolumeChange={handleVolumeChange}
      onBufferingChange={handleBufferingChange}
      isActive={options.isActive ?? true}
    />
  )

  const update = (extra: Partial<typeof options> = {}) => {
    rerender(
      <AdjustedPreviewPlayer
        clipStartTime={extra.clipStartTime ?? options.clipStartTime ?? 5}
        clipEndTime={extra.clipEndTime ?? options.clipEndTime ?? 15}
        sourceUrl={extra.sourceUrl ?? options.sourceUrl ?? 'raw-source.mp4'}
        fallbackPreviewUrl="fallback-preview.mp4"
        fallbackPoster="poster.png"
        globalPlayhead={extra.globalPlayhead ?? playhead}
        onGlobalPlayheadChange={handlePlayheadChange}
        sharedVolume={sharedVolume}
        onSharedVolumeChange={handleVolumeChange}
        onBufferingChange={handleBufferingChange}
        isActive={extra.isActive ?? options.isActive ?? true}
      />
    )
    if (extra.globalPlayhead !== undefined) {
      playhead = extra.globalPlayhead
      options.globalPlayhead = playhead
    }
    if (extra.clipStartTime !== undefined) {
      options.clipStartTime = extra.clipStartTime
    }
    if (extra.clipEndTime !== undefined) {
      options.clipEndTime = extra.clipEndTime
    }
    if (extra.isActive !== undefined) {
      options.isActive = extra.isActive
    }
  }

  const getVideo = (): MediaElement => container.querySelector('video') as MediaElement

  return {
    update,
    getVideo,
    getPlayhead: () => playhead,
    handlePlayheadChange,
    handleBufferingChange
  }
}

describe('AdjustedPreviewPlayer', () => {
  beforeAll(() => {
    if (typeof HTMLMediaElement === 'undefined') {
      throw new Error('HTMLMediaElement is not available in the current test environment')
    }
    originalDescriptors.play = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'play'
    )
    originalDescriptors.pause = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'pause'
    )
    originalDescriptors.currentTime = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'currentTime'
    )
    originalDescriptors.duration = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'duration'
    )
    originalDescriptors.readyState = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'readyState'
    )
    originalDescriptors.paused = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'paused'
    )
    installMediaMocks()
  })

  afterAll(() => {
    restoreMediaMocks()
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeks to the updated start when the range moves during playback', async () => {
    const harness = renderPlayer({ clipStartTime: 5, clipEndTime: 15, globalPlayhead: 6 })
    const video = harness.getVideo()

    await waitForCurrentTime(video, 6)

    await act(async () => {
      await video.play()
    })

    harness.update({ clipStartTime: 8 })

    await waitForCurrentTime(video, 8)
    await waitFor(() => {
      expect(harness.getPlayhead()).toBeCloseTo(8, 3)
    })
    harness.update({ globalPlayhead: harness.getPlayhead() })
  })

  it('clamps the playhead when scrubbing outside the clip window', async () => {
    const harness = renderPlayer({ clipStartTime: 5, clipEndTime: 12, globalPlayhead: 2 })
    const video = harness.getVideo()

    await waitForCurrentTime(video, 5)
    harness.update({ globalPlayhead: harness.getPlayhead() })

    await waitFor(() => {
      expect(harness.handlePlayheadChange).toHaveBeenLastCalledWith(5)
    })

    harness.update({ globalPlayhead: 20 })

    await waitForCurrentTime(video, 12)
    await waitFor(() => {
      expect(harness.handlePlayheadChange).toHaveBeenLastCalledWith(12)
    })
    harness.update({ globalPlayhead: harness.getPlayhead() })
  })

  it('halts playback at the end of short clip windows', async () => {
    const harness = renderPlayer({ clipStartTime: 10, clipEndTime: 10.15, globalPlayhead: 10.05 })
    const video = harness.getVideo()

    await waitForCurrentTime(video, 10.05)

    await act(async () => {
      await video.play()
    })

    video.currentTime = 10.2
    video.dispatchEvent(new Event('timeupdate'))

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
    expect(video.currentTime).toBeCloseTo(10.15, 3)
    expect(harness.handlePlayheadChange).toHaveBeenLastCalledWith(10.15)
    harness.update({ globalPlayhead: harness.getPlayhead() })
  })

  it('retains the playhead when toggling active state', async () => {
    const harness = renderPlayer({ clipStartTime: 5, clipEndTime: 15, globalPlayhead: 6, isActive: true })
    const video = harness.getVideo()

    await waitForCurrentTime(video, 6)

    await act(async () => {
      await video.play()
    })

    video.currentTime = 9
    video.dispatchEvent(new Event('timeupdate'))
    harness.update({ globalPlayhead: harness.getPlayhead() })

    await waitFor(() => {
      expect(harness.getPlayhead()).toBeCloseTo(9, 3)
    })

    harness.update({ isActive: false })
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()

    harness.update({ isActive: true })

    await waitForCurrentTime(video, 9)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })
})

const waitForCurrentTime = async (video: MediaElement, expected: number): Promise<void> => {
  await waitFor(() => {
    expect(video.currentTime).toBeCloseTo(expected, 3)
  })
}

