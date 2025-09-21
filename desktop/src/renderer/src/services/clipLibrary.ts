import { BACKEND_MODE, buildAccountClipsUrl } from '../config/backend'
import type { Clip } from '../types'
import type { ClipAdjustmentPayload } from './pipelineApi'

type RawClipPayload = {
  id?: unknown
  title?: unknown
  channel?: unknown
  created_at?: unknown
  duration_seconds?: unknown
  description?: unknown
  playback_url?: unknown
  preview_url?: unknown
  source_url?: unknown
  source_title?: unknown
  source_published_at?: unknown
  video_id?: unknown
  video_title?: unknown
  views?: unknown
  rating?: unknown
  quote?: unknown
  reason?: unknown
  account?: unknown
  timestamp_url?: unknown
  timestamp_seconds?: unknown
  thumbnail_url?: unknown
  start_seconds?: unknown
  end_seconds?: unknown
  original_start_seconds?: unknown
  original_end_seconds?: unknown
  has_adjustments?: unknown
}

const isClipArray = (value: unknown): value is Clip[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'object' && item !== null && 'id' in item)
}

export const normaliseClip = (payload: RawClipPayload): Clip | null => {
  const {
    id,
    title,
    channel,
    created_at: createdAt,
    duration_seconds: durationSeconds,
    description,
    playback_url: playbackUrl,
    preview_url: previewUrlRaw,
    source_url: sourceUrl,
    source_title: sourceTitle,
    source_published_at: sourcePublishedAt,
    video_id: videoId,
    video_title: videoTitle,
    views,
    rating,
    quote,
    reason,
    account,
    timestamp_url: timestampUrl,
    timestamp_seconds: timestampSeconds,
    thumbnail_url: thumbnailUrl,
    start_seconds: startSecondsRaw,
    end_seconds: endSecondsRaw,
    original_start_seconds: originalStartSecondsRaw,
    original_end_seconds: originalEndSecondsRaw,
    has_adjustments: hasAdjustmentsRaw
  } = payload

  if (typeof id !== 'string' || id.length === 0) {
    return null
  }
  if (typeof title !== 'string' || title.length === 0) {
    return null
  }
  if (typeof createdAt !== 'string' || createdAt.length === 0) {
    return null
  }
  if (typeof durationSeconds !== 'number') {
    return null
  }
  if (typeof playbackUrl !== 'string' || playbackUrl.length === 0) {
    return null
  }
  if (typeof description !== 'string') {
    return null
  }
  if (typeof sourceUrl !== 'string') {
    return null
  }
  const previewUrl =
    typeof previewUrlRaw === 'string' && previewUrlRaw.length > 0 ? previewUrlRaw : playbackUrl
  if (typeof previewUrl !== 'string' || previewUrl.length === 0) {
    return null
  }
  if (typeof sourceTitle !== 'string' || sourceTitle.length === 0) {
    return null
  }
  const videoIdValue = typeof videoId === 'string' && videoId.length > 0 ? videoId : id
  const videoTitleValue =
    typeof videoTitle === 'string' && videoTitle.length > 0 ? videoTitle : sourceTitle

  const startSeconds =
    typeof startSecondsRaw === 'number' && Number.isFinite(startSecondsRaw)
      ? Math.max(0, startSecondsRaw)
      : 0
  const endSeconds =
    typeof endSecondsRaw === 'number' && Number.isFinite(endSecondsRaw)
      ? Math.max(startSeconds, endSecondsRaw)
      : startSeconds + Math.max(0, durationSeconds)
  const originalStartSeconds =
    typeof originalStartSecondsRaw === 'number' && Number.isFinite(originalStartSecondsRaw)
      ? Math.max(0, originalStartSecondsRaw)
      : startSeconds
  const originalEndSeconds =
    typeof originalEndSecondsRaw === 'number' && Number.isFinite(originalEndSecondsRaw)
      ? Math.max(originalStartSeconds, originalEndSecondsRaw)
      : endSeconds
  const hasAdjustments = hasAdjustmentsRaw === true

  const clip: Clip = {
    id,
    title,
    channel: typeof channel === 'string' && channel.length > 0 ? channel : 'Unknown channel',
    views: typeof views === 'number' ? views : null,
    createdAt,
    durationSec: durationSeconds,
    thumbnail: typeof thumbnailUrl === 'string' && thumbnailUrl.length > 0 ? thumbnailUrl : null,
    playbackUrl,
    previewUrl,
    description,
    sourceUrl,
    sourceTitle,
    sourcePublishedAt: typeof sourcePublishedAt === 'string' ? sourcePublishedAt : null,
    videoId: videoIdValue,
    videoTitle: videoTitleValue,
    rating: typeof rating === 'number' ? rating : rating === null ? null : undefined,
    quote: typeof quote === 'string' ? quote : quote === null ? null : undefined,
    reason: typeof reason === 'string' ? reason : reason === null ? null : undefined,
    timestampUrl: typeof timestampUrl === 'string' ? timestampUrl : timestampUrl === null ? null : undefined,
    timestampSeconds:
      typeof timestampSeconds === 'number'
        ? timestampSeconds
        : timestampSeconds === null
        ? null
        : undefined,
    accountId: typeof account === 'string' ? account : account === null ? null : undefined,
    startSeconds,
    endSeconds,
    originalStartSeconds,
    originalEndSeconds,
    hasAdjustments
  }

  return clip
}

const fetchAccountClipsFromApi = async (accountId: string): Promise<Clip[]> => {
  const url = buildAccountClipsUrl(accountId)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }
  const payload = (await response.json()) as unknown
  if (!Array.isArray(payload)) {
    return []
  }
  const clips = payload
    .map((item) => (item && typeof item === 'object' ? normaliseClip(item as RawClipPayload) : null))
    .filter((clip): clip is Clip => clip !== null)
  return clips
}

export const listAccountClips = async (accountId: string | null): Promise<Clip[]> => {
  if (!accountId) {
    return []
  }

  if (BACKEND_MODE === 'api' || typeof window === 'undefined' || !window.api?.listAccountClips) {
    try {
      return await fetchAccountClipsFromApi(accountId)
    } catch (error) {
      console.error('Unable to load clips from API library', error)
      return []
    }
  }

  try {
    const clips = await window.api.listAccountClips(accountId)
    return isClipArray(clips) ? clips : []
  } catch (error) {
    console.error('Unable to load clips from library bridge', error)
    return []
  }
}

const isFolderBridgeAvailable = (): boolean => {
  return typeof window !== 'undefined' && typeof window.api?.openAccountClipsFolder === 'function'
}

export const canOpenAccountClipsFolder = (): boolean => {
  if (BACKEND_MODE === 'api') {
    return false
  }
  return isFolderBridgeAvailable()
}

export const openAccountClipsFolder = async (accountId: string): Promise<boolean> => {
  if (!accountId) {
    return false
  }
  if (BACKEND_MODE === 'api' || typeof window === 'undefined' || !window.api?.openAccountClipsFolder) {
    console.warn('openAccountClipsFolder bridge is unavailable in API mode.')
    return false
  }

  try {
    return await window.api.openAccountClipsFolder(accountId)
  } catch (error) {
    console.error('Unable to open clips folder through bridge', error)
    return false
  }
}

export const adjustLibraryClip = async (
  accountId: string,
  clipId: string,
  adjustment: ClipAdjustmentPayload
): Promise<Clip> => {
  const baseUrl = buildAccountClipsUrl(accountId)
  const url = `${baseUrl}/${encodeURIComponent(clipId)}/adjust`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_seconds: adjustment.startSeconds,
      end_seconds: adjustment.endSeconds
    })
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as RawClipPayload
  const clip = normaliseClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the library API.')
  }
  return clip
}

export const fetchLibraryClip = async (accountId: string, clipId: string): Promise<Clip> => {
  const baseUrl = buildAccountClipsUrl(accountId)
  const url = `${baseUrl}/${encodeURIComponent(clipId)}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as RawClipPayload
  const clip = normaliseClip(payload)
  if (!clip) {
    throw new Error('Received malformed clip data from the library API.')
  }
  return clip
}

export default listAccountClips
