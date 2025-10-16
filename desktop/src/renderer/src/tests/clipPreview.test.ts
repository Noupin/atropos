import { describe, expect, it } from 'vitest'
import { getClipPlaybackWindow, getClipPreviewState } from '../lib/clipPreview'

describe('getClipPlaybackWindow', () => {
  it('computes playback start, end, and duration from the clip bounds', () => {
    const window = getClipPlaybackWindow({
      startSeconds: 4,
      endSeconds: 9,
      sourceDurationSeconds: 20
    })

    expect(window.playbackStart).toBe(4)
    expect(window.playbackEnd).toBe(9)
    expect(window.playbackDuration).toBe(5)
  })

  it('limits the playback window to the available source duration', () => {
    const window = getClipPlaybackWindow({
      startSeconds: 30,
      endSeconds: 120,
      sourceDurationSeconds: 40
    })

    expect(window.playbackStart).toBe(30)
    expect(window.playbackEnd).toBe(70)
    expect(window.playbackDuration).toBe(40)
  })
})

describe('getClipPreviewState', () => {
  it('maps playhead within the clip window to clip-local time', () => {
    const state = getClipPreviewState(
      {
        startSeconds: 10,
        endSeconds: 20,
        sourceDurationSeconds: 30
      },
      13.5
    )

    expect(state.playbackStart).toBe(10)
    expect(state.playbackEnd).toBe(20)
    expect(state.playbackDuration).toBe(10)
    expect(state.localTime).toBeCloseTo(3.5)
    expect(state.absoluteTime).toBeCloseTo(13.5)
  })

  it('clamps playhead before the start of the clip', () => {
    const state = getClipPreviewState(
      {
        startSeconds: 5,
        endSeconds: 15,
        sourceDurationSeconds: null
      },
      2
    )

    expect(state.localTime).toBe(0)
    expect(state.absoluteTime).toBe(5)
  })

  it('clamps playhead beyond the end of the clip and respects source bounds', () => {
    const state = getClipPreviewState(
      {
        startSeconds: 2,
        endSeconds: 12,
        sourceDurationSeconds: 8
      },
      20
    )

    expect(state.playbackEnd).toBe(10)
    expect(state.playbackDuration).toBe(8)
    expect(state.localTime).toBe(8)
    expect(state.absoluteTime).toBe(10)
  })
})
