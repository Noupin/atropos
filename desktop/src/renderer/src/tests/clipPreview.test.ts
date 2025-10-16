import { describe, expect, it } from 'vitest'
import { getClipPreviewState } from '../lib/clipPreview'

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

    expect(state.in).toBe(10)
    expect(state.out).toBe(20)
    expect(state.duration).toBe(10)
    expect(state.tClip).toBeCloseTo(3.5)
    expect(state.isOutOfRange).toBe(false)
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

    expect(state.tClip).toBe(0)
    expect(state.isOutOfRange).toBe(true)
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

    expect(state.out).toBe(10)
    expect(state.duration).toBe(8)
    expect(state.tClip).toBe(8)
    expect(state.isOutOfRange).toBe(true)
  })
})
