import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDuration, formatViews, timeAgo } from '../lib/format'

describe('formatViews', () => {
  it('formats numbers below 1K without suffix', () => {
    expect(formatViews(950)).toBe('950')
  })

  it('formats thousands with K suffix', () => {
    expect(formatViews(1000)).toBe('1K')
    expect(formatViews(15250)).toBe('15K')
  })

  it('formats millions with one decimal place when needed', () => {
    expect(formatViews(1_532_000)).toBe('1.5M')
    expect(formatViews(20_000_000)).toBe('20M')
  })
})

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-10T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns natural language for recent past times', () => {
    expect(timeAgo('2025-01-10T10:00:00Z')).toBe('2 hours ago')
    expect(timeAgo('2025-01-09T12:00:00Z')).toBe('yesterday')
  })

  it('handles future dates gracefully', () => {
    expect(timeAgo('2025-01-12T12:00:00Z')).toBe('in 2 days')
  })
})

describe('formatDuration', () => {
  it('formats durations under an hour as mm:ss', () => {
    expect(formatDuration(230)).toBe('3:50')
    expect(formatDuration(5)).toBe('0:05')
  })

  it('formats durations over an hour as h:mm:ss', () => {
    expect(formatDuration(3670)).toBe('1:01:10')
  })
})
