import type { Clip } from '../types'

type PlaybackClip = Pick<
  Clip,
  'playbackUrl' | 'createdAt' | 'startSeconds' | 'endSeconds'
>

const isAbsoluteUrl = (value: string): boolean => {
  return value.startsWith('http://') || value.startsWith('https://') || value.startsWith('file://')
}

/**
 * Build a cache-busted playback URL for a clip so the rendered short loads immediately.
 */
export const buildCacheBustedPlaybackUrl = (clip: PlaybackClip): string => {
  const { playbackUrl } = clip
  if (typeof playbackUrl !== 'string' || playbackUrl.length === 0) {
    return ''
  }

  const start =
    typeof clip.startSeconds === 'number' && Number.isFinite(clip.startSeconds)
      ? clip.startSeconds
      : 0
  const end =
    typeof clip.endSeconds === 'number' && Number.isFinite(clip.endSeconds)
      ? clip.endSeconds
      : start
  const createdAtKey = typeof clip.createdAt === 'string' ? clip.createdAt : ''
  const cacheKey = `${createdAtKey}-${start}-${end}`

  try {
    const absolute = isAbsoluteUrl(playbackUrl)
      ? new URL(playbackUrl)
      : typeof window !== 'undefined'
        ? new URL(playbackUrl, window.location.origin)
        : null
    if (absolute) {
      absolute.searchParams.set('_', cacheKey)
      return absolute.toString()
    }
  } catch (error) {
    // fall back to manual cache-busting below
  }

  const separator = playbackUrl.includes('?') ? '&' : '?'
  return `${playbackUrl}${separator}_=${encodeURIComponent(cacheKey)}`
}

