import { describe, expect, it } from 'vitest'
import { buildCacheBustedPlaybackUrl } from '../lib/video'

describe('buildCacheBustedPlaybackUrl', () => {
  it('adds a stable cache token to absolute playback URLs', () => {
    const clip = {
      playbackUrl: 'https://cdn.atropos.dev/library/clip.mp4',
      createdAt: '2024-03-10T12:00:00Z',
      startSeconds: 5,
      endSeconds: 27
    }

    const result = buildCacheBustedPlaybackUrl(clip)
    const parsed = new URL(result)

    expect(parsed.origin + parsed.pathname).toBe('https://cdn.atropos.dev/library/clip.mp4')
    expect(parsed.searchParams.get('_')).toBe('2024-03-10T12:00:00Z-5-27')
  })

  it('preserves existing query parameters when appending the cache token', () => {
    const clip = {
      playbackUrl: 'https://cdn.atropos.dev/library/clip.mp4?token=abc123',
      createdAt: '2024-04-01T09:30:00Z',
      startSeconds: 0,
      endSeconds: 45
    }

    const result = buildCacheBustedPlaybackUrl(clip)

    expect(result).toContain('token=abc123')
    expect(result).toContain('&_=2024-04-01T09%3A30%3A00Z-0-45')
  })
})
