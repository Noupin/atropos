import { describe, expect, it } from 'vitest'
import { clampToRange, resolvePlaybackTarget, isBeyondPlaybackWindow } from '../lib/previewWindow'

describe('previewWindow helpers', () => {
  describe('clampToRange', () => {
    it('returns the lower bound when value is below the range', () => {
      expect(clampToRange(3, 5, 10)).toBe(5)
    })

    it('returns the upper bound when value exceeds the range', () => {
      expect(clampToRange(12, 5, 10)).toBe(10)
    })

    it('returns the value when already within the range', () => {
      expect(clampToRange(7.5, 5, 10)).toBeCloseTo(7.5)
    })

    it('handles inverted minimum and maximum values', () => {
      expect(clampToRange(7, 10, 5)).toBe(7)
    })

    it('defaults to the lower bound when the value is not finite', () => {
      expect(clampToRange(Number.NaN, 2, 6)).toBe(2)
    })

    it('returns the original value when the bounds are not finite', () => {
      expect(clampToRange(4, Number.NaN, Number.POSITIVE_INFINITY)).toBe(4)
    })
  })

  describe('resolvePlaybackTarget', () => {
    it('returns the clip start when duration is zero', () => {
      expect(resolvePlaybackTarget(8, 8, 10)).toBe(8)
    })

    it('clamps the playhead before adding it to the clip start', () => {
      expect(resolvePlaybackTarget(2, 6, 10)).toBe(6)
    })

    it('returns the clip start when the playhead is before the window', () => {
      expect(resolvePlaybackTarget(4, 9, 1)).toBe(4)
    })

    it('ignores negative clip starts', () => {
      expect(resolvePlaybackTarget(-10, -5, -8)).toBe(0)
    })
  })

  describe('isBeyondPlaybackWindow', () => {
    it('returns false when the current time is within bounds', () => {
      expect(isBeyondPlaybackWindow(4.9, 5)).toBe(false)
    })

    it('returns true when the current time reaches the end', () => {
      expect(isBeyondPlaybackWindow(5.01, 5)).toBe(true)
    })

    it('returns false when inputs are not finite', () => {
      expect(isBeyondPlaybackWindow(Number.NaN, Number.NaN)).toBe(false)
    })

    it('returns false for non-positive clip ends', () => {
      expect(isBeyondPlaybackWindow(5, 0)).toBe(false)
    })
  })
})
